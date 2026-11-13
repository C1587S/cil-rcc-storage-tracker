#!/usr/bin/env python3
"""Load cil-dupverify results into ClickHouse (tables from
clickhouse/schema/06_duplicate_verification.sql).

Reads <out>/results.jsonl and <out>/summary-*.json. Runs already present in
filesystem.dupverify_runs are skipped, so re-running is safe. Only
complete groups contribute verified files; incomplete, deferred and
skipped groups are stored with their status so the UI can show them.

  python3 scripts/dupverify/import_results.py --out ~/dupverify/run1 [--dry-run]

CH_EXEC overrides the client (default: docker compose exec -T clickhouse clickhouse-client).
Prints counts only (no paths).
"""
import argparse
import glob
import json
import os
import shlex
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def client() -> list[str]:
    return shlex.split(os.environ.get("CH_EXEC", "docker compose exec -T clickhouse clickhouse-client"))


def query(sql: str, params: dict | None = None) -> str:
    args = client() + ["--readonly=1"] + [f"--param_{k}={v}" for k, v in (params or {}).items()]
    r = subprocess.run(args, cwd=ROOT, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"query failed: {r.stderr.strip()[:500]}")
    return r.stdout


def insert(table: str, rows: list[dict]):
    if not rows:
        return
    data = "".join(json.dumps(r) + "\n" for r in rows)
    r = subprocess.run(client() + ["--query", f"INSERT INTO filesystem.{table} FORMAT JSONEachRow"],
                       cwd=ROOT, input=data, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"insert into {table} failed: {r.stderr.strip()[:500]}")


def ch_time(iso: str) -> str:
    return iso.replace("T", " ").rstrip("Z")


def split_group_id(gid: str) -> tuple[str, str]:
    """group_id is '<snapshot_date>:<scope_id>:<size>' (export_candidates.py)."""
    parts = gid.split(":")
    if len(parts) != 3:
        raise ValueError(f"unexpected group_id format: {gid!r}")
    return parts[0], parts[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="cil-dupverify output directory")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    summaries = {}
    for p in glob.glob(os.path.join(a.out, "summary-*.json")):
        with open(p) as f:
            s = json.load(f)
        summaries[s["run_id"]] = s

    lines_by_run = defaultdict(list)
    unparsable = 0
    with open(os.path.join(a.out, "results.jsonl")) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                unparsable += 1  # a line cut off by a crash; that group was redone by the next run
                continue
            lines_by_run[r["run_id"]].append(r)

    run_ids = sorted(lines_by_run)
    known = set()
    if run_ids and not a.dry_run:
        out = query("SELECT run_id FROM filesystem.dupverify_runs WHERE has({ids:Array(String)}, run_id)",
                    {"ids": "[" + ",".join("'" + i.replace("'", "") + "'" for i in run_ids) + "]"})
        known = set(out.split())

    totals = defaultdict(int)
    for run_id in run_ids:
        if run_id in known:
            totals["runs_already_imported"] += 1
            continue
        lines = lines_by_run[run_id]
        groups, files, skipped = [], [], []
        snap = scope = None
        for r in lines:
            snap, scope = split_group_id(r["group_id"])
            at = ch_time(r["verified_at"])
            groups.append({
                "snapshot_date": snap, "scope_id": scope, "group_id": r["group_id"], "run_id": run_id,
                "verified_at": at, "size": r["size"], "status": r["status"],
                "common_dir": r.get("common_dir", ""), "files_in": r["files_in"],
                "inodes_examined": r["inodes_examined"], "unique_inodes": r["unique_inodes"],
                "hardlink_paths": r["hardlink_paths"], "duplicate_sets": len(r["duplicate_sets"]),
                "skipped": len(r["skipped"]),
                "bytes_read": sum(r["io"][k] for k in ("sample_bytes", "full_bytes", "compare_bytes")),
                "note": r.get("note") or "",
            })
            for s in r["skipped"]:
                skipped.append({"snapshot_date": snap, "group_id": r["group_id"], "run_id": run_id,
                                "verified_at": at, "path": s["path"], "reason": s["reason"]})
            if r["status"] != "complete":
                continue  # nothing in a non-complete group counts as verified
            for d in r["duplicate_sets"]:
                for ino in d["inodes"]:
                    for pe in ino["paths"]:
                        files.append({
                            "snapshot_date": snap, "group_id": r["group_id"], "run_id": run_id,
                            "verified_at": at, "set_blake3": d["blake3"], "size": r["size"],
                            "byte_verified": int(d["byte_verified"]), "copies": d["copies"],
                            "external_links": int(d["external_links"]), "dev": ino["dev"], "inode": ino["ino"],
                            "nlink": ino["nlink"], "allocated_bytes": ino["allocated_bytes"],
                            "mtime_ns": ino.get("mtime_ns", 0), "ctime_ns": ino.get("ctime_ns", 0),
                            "sparse": int(ino["sparse"]), "path": pe["path"], "owner": pe.get("owner") or "",
                        })
        s = summaries.get(run_id)
        run = {
            "run_id": run_id, "snapshot_date": snap, "scope_id": scope,
            "tool": s["tool"] if s else "cil-dupverify",
            "started_at": ch_time(s["started_at"]) if s else ch_time(min(l["verified_at"] for l in lines)),
            "finished_at": ch_time(s["finished_at"]) if s else ch_time(max(l["verified_at"] for l in lines)),
            # A run without a summary ended abnormally (killed before writing it).
            "stopped": (s.get("stopped") or "") if s else "no_summary",
            "settings": json.dumps(s["settings"]) if s else "{}",
            "groups_complete": sum(g["status"] == "complete" for g in groups),
            "groups_incomplete": sum(g["status"] == "incomplete" for g in groups),
            "groups_deferred": sum(g["status"] == "deferred" for g in groups),
            "groups_skipped": sum(g["status"] == "skipped" for g in groups),
            "groups_not_attempted": s["groups_not_attempted"] if s else 0,
            "files_in": sum(g["files_in"] for g in groups),
            "inodes_examined": s["inodes_examined"] if s else 0,
            "duplicate_sets": s["duplicate_sets"] if s else 0,
            "duplicate_inodes": s["duplicate_inodes"] if s else 0,
            "verified_logical_bytes": s["verified_logical_bytes"] if s else 0,
            "verified_allocated_bytes": s["verified_allocated_bytes"] if s else 0,
            "bytes_read": sum(g["bytes_read"] for g in groups),
            "elapsed_s": s["elapsed_s"] if s else 0.0,
            "skipped_by_reason": json.dumps(s["skipped_by_reason"]) if s else "{}",
        }
        totals["runs"] += 1
        totals["groups"] += len(groups)
        totals["verified_paths"] += len(files)
        totals["skipped_paths"] += len(skipped)
        if a.dry_run:
            continue
        # Run row last: its presence marks the import of this run as done.
        insert("dupverify_groups", groups)
        insert("dupverify_files", files)
        insert("dupverify_skipped", skipped)
        insert("dupverify_runs", [run])
    print(json.dumps({"dry_run": a.dry_run, "unparsable_lines": unparsable, **totals}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
