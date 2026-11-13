#!/usr/bin/env python3
"""Export duplicate candidate groups from a snapshot (read-only).

A candidate group is every file of one exact byte size: identical content
implies identical size, and nothing else (name, extension, directory) is
assumed. Singleton sizes are dropped here; hard links, symlinks and changed
files are resolved later by cil-dupverify, which checks the live filesystem.

Two phases keep memory bounded on the server and here:
  1. sizes with >= 2 files, ranked (by default by the unverified upper bound
     (n - 1) * size), optionally limited;
  2. paths for those sizes, fetched in batches and streamed to JSONL.

Queries run through clickhouse-client with readonly=1. Output files are
created 0600: they contain real paths and must not be committed.

  python3 scripts/dupverify/export_candidates.py --date 2026-11-13 \
      --min-size 1G --prefix /project/cil/some_lab --max-groups 500 \
      --out ~/dupverify/candidates.jsonl

CH_EXEC overrides the client (default: docker compose exec -T clickhouse clickhouse-client).
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UNITS = {"": 1, "K": 1 << 10, "M": 1 << 20, "G": 1 << 30, "T": 1 << 40}
ORDERS = {
    "potential": "(n - 1) * size DESC, size DESC",
    "size": "size DESC",
    "count": "n DESC, size DESC",
}


def parse_size(s: str) -> int:
    m = re.fullmatch(r"\s*(\d+)\s*([KMGT]?)(?:i?B)?\s*", s, re.I)
    if not m:
        raise argparse.ArgumentTypeError(f"bad size: {s!r} (e.g. 1048576, 100M, 1G)")
    return int(m.group(1)) * UNITS[m.group(2).upper()]


def ch_literal_array(items: list[str]) -> str:
    return "[" + ",".join("'" + i.replace("\\", "\\\\").replace("'", "\\'") + "'" for i in items) + "]"


def norm_prefix(p: str) -> str:
    p = p.rstrip("/")
    if not p.startswith("/"):
        raise argparse.ArgumentTypeError(f"prefix must be absolute: {p!r}")
    return p + "/"


class CH:
    def __init__(self):
        self.cmd = shlex.split(os.environ.get(
            "CH_EXEC", "docker compose exec -T clickhouse clickhouse-client"))

    def stream(self, sql: str, params: dict):
        """Yield JSONEachRow records; the query reaches the client on stdin."""
        args = self.cmd + ["--readonly=1", "--max_execution_time=600"]
        args += [f"--param_{k}={v}" for k, v in params.items()]
        p = subprocess.Popen(args, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        p.stdin.write(sql + " FORMAT JSONEachRow")
        p.stdin.close()
        for line in p.stdout:
            if line.strip():
                yield json.loads(line)
        err = p.stderr.read()
        if p.wait() != 0:
            raise SystemExit(f"clickhouse-client failed: {err.strip()[:500]}")


FILTER = """
    snapshot_date = {d:Date}
    AND is_directory = 0 AND file_type != 'directory'
    AND size >= {min:UInt64} AND size <= {max:UInt64}
    AND ({anyp:UInt8} = 1 OR arrayExists(p -> startsWith(path, p), {inc:Array(String)}))
    AND NOT arrayExists(p -> startsWith(path, p), {exc:Array(String)})
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True, help="snapshot date (YYYY-MM-DD)")
    ap.add_argument("--out", required=True, help="candidate JSONL to write (a .meta.json is written beside it)")
    ap.add_argument("--min-size", type=parse_size, default=parse_size("1M"))
    ap.add_argument("--max-size", type=parse_size, default=(1 << 63) - 1)
    ap.add_argument("--prefix", action="append", default=[], type=norm_prefix,
                    help="only files under this directory (repeatable)")
    ap.add_argument("--exclude-prefix", action="append", default=[], type=norm_prefix)
    ap.add_argument("--order", choices=ORDERS, default="potential",
                    help="batch priority (default: largest unverified upper bound first)")
    ap.add_argument("--max-groups", type=int, default=0, help="0 = all")
    ap.add_argument("--max-files-per-group", type=int, default=50_000,
                    help="list at most this many paths per group (marked truncated)")
    ap.add_argument("--skip-groups-over", type=int, default=0,
                    help="leave out groups with more files than this (0 = keep all); for small pilots")
    ap.add_argument("--batch-sizes", type=int, default=2000, help="sizes per path query")
    a = ap.parse_args()
    dt.date.fromisoformat(a.date)
    if a.min_size < 1:
        a.min_size = 1  # zero-byte files hold no data

    scope = {"date": a.date, "min_size": a.min_size, "max_size": a.max_size,
             "prefix": sorted(a.prefix), "exclude_prefix": sorted(a.exclude_prefix),
             "max_files_per_group": a.max_files_per_group, "skip_groups_over": a.skip_groups_over}
    scope_id = hashlib.blake2b(json.dumps(scope, sort_keys=True).encode(), digest_size=4).hexdigest()
    params = {"d": a.date, "min": a.min_size, "max": a.max_size, "anyp": int(not a.prefix),
              "inc": ch_literal_array(a.prefix), "exc": ch_literal_array(a.exclude_prefix)}
    ch = CH()

    limit = f"LIMIT {int(a.max_groups)}" if a.max_groups > 0 else ""
    having = f"n >= 2 AND n <= {int(a.skip_groups_over)}" if a.skip_groups_over > 0 else "n >= 2"
    groups = list(ch.stream(
        f"SELECT size, count() AS n FROM filesystem.entries WHERE {FILTER} "
        f"GROUP BY size HAVING {having} ORDER BY {ORDERS[a.order]} {limit}", params))

    tmp = a.out + ".partial"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    stats = {"groups": 0, "files": 0, "files_listed": 0, "truncated_groups": 0,
             "largest_group": 0, "potential_bytes_upper_bound": 0, "full_read_bytes_upper_bound": 0}
    with os.fdopen(fd, "w") as out:
        for i in range(0, len(groups), a.batch_sizes):
            batch = groups[i:i + a.batch_sizes]
            files: dict[int, list] = {int(g["size"]): [] for g in batch}
            q = (f"SELECT size, path, owner FROM filesystem.entries WHERE {FILTER} "
                 "AND has({sizes:Array(UInt64)}, size) ORDER BY size, path")
            for r in ch.stream(q, {**params, "sizes": "[" + ",".join(str(s) for s in files) + "]"}):
                lst = files[int(r["size"])]
                if len(lst) <= a.max_files_per_group:  # keep one extra to detect truncation
                    lst.append({"path": r["path"], "owner": r["owner"] or None})
            for g in batch:
                size, n = int(g["size"]), int(g["n"])
                lst = files[size]
                truncated = len(lst) > a.max_files_per_group or len(lst) < n
                lst = lst[:a.max_files_per_group]
                if len(lst) < 2:
                    continue
                out.write(json.dumps({"group_id": f"{a.date}:{scope_id}:{size}", "size": size,
                                      "files": lst, "truncated": truncated}) + "\n")
                stats["groups"] += 1
                stats["files"] += n
                stats["files_listed"] += len(lst)
                stats["truncated_groups"] += truncated
                stats["largest_group"] = max(stats["largest_group"], n)
                stats["potential_bytes_upper_bound"] += (n - 1) * size
                stats["full_read_bytes_upper_bound"] += len(lst) * size
    os.replace(tmp, a.out)

    meta = {"kind": "cil-dupverify-candidates", "version": 1, "scope_id": scope_id, "scope": scope,
            "order": a.order, "max_groups": a.max_groups,
            "created_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "basis": "exact size only; unverified", **stats}
    mfd = os.open(a.out + ".meta.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(mfd, "w") as m:
        json.dump(meta, m, indent=2)
    # Counts only on stdout: no paths in logs.
    print(json.dumps({k: meta[k] for k in ("scope_id", "groups", "files", "files_listed", "truncated_groups",
                                            "largest_group", "potential_bytes_upper_bound",
                                            "full_read_bytes_upper_bound")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
