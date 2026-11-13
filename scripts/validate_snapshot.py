#!/usr/bin/env python3
"""Read-only validation of an imported snapshot before it counts as "restored".

Reconciles what the scanner says it wrote (the published per-source scan
manifests) with what ClickHouse holds, and checks the known integrity
issues. Runs as the read-only tracker_api account; changes nothing.

  apps/api/venv/bin/python scripts/validate_snapshot.py [--date YYYY-MM-DD] [--previous YYYY-MM-DD]

Exit 0 if every required check passes; 1 otherwise. "warn" lines are
known, tracked issues that do not block (see docs/roadmap.md, stage 3).
"""
import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "scripts" / "bench"))

from bench_read_paths import ch_client, load_env  # noqa: E402

RCC_URL = "https://users.rcc.uchicago.edu/~cadavidsanchez/cil_scans"
EXPECTED_SOURCES = ["battuta-shares-S3-archive", "battuta_shares", "gcp", "home_dirs",
                    "kupe_shares", "norgay", "sacagawea_shares", "coastal"]
ROOT_PATH = "/project/cil"

results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str, required: bool = True):
    status = "pass" if ok else ("FAIL" if required else "warn")
    results.append((status, name, detail))
    print(f"  {status:4s}  {name:58s} {detail}")


def fetch_manifest(src: str, date: str) -> dict | None:
    from app import rcc_tls
    try:
        return json.loads(rcc_tls.fetch(f"{RCC_URL}/{src}_{date}_manifest.json", timeout=30))
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--previous", help="earlier full snapshot for the drift check")
    ap.add_argument("--max-drift", type=float, default=0.25,
                    help="max relative change in a source's entries vs --previous")
    a = ap.parse_args()

    ch = ch_client(load_env())
    q = lambda sql, **p: ch.execute(sql, {"d": a.date, **p})  # noqa: E731
    a.date = a.date or str(ch.execute("SELECT max(snapshot_date) FROM snapshots")[0][0])
    print(f"Validating snapshot {a.date}\n")

    # 1. Scanner manifests vs imported rows, per source
    by_src = dict(q("SELECT splitByChar('/', path)[4] AS src, count() FROM entries "
                    "WHERE snapshot_date = %(d)s AND startsWith(path, '/project/cil/') GROUP BY src"))
    manifest_total = 0
    for src in EXPECTED_SOURCES:
        m = fetch_manifest(src, a.date)
        if m is None:
            check(f"manifest published: {src}", False, "no manifest for this date")
            continue
        rows = int(m.get("total_rows", 0))
        manifest_total += rows
        check(f"manifest complete: {src}", bool(m.get("completed")), f"total_rows={rows:,}")
        got = by_src.get(src, 0)
        # The source's own root directory row is counted by the scanner too.
        check(f"imported == scanned: {src}", got == rows, f"entries={got:,} manifest={rows:,}")

    # 2. No duplicate paths
    n, u = q("SELECT count(), uniqExact(path) FROM entries WHERE snapshot_date = %(d)s")[0]
    check("no duplicate paths", n == u, f"rows={n:,} unique={u:,} duplicates={n - u:,}")

    # 3. Snapshot registry matches the data
    reg = q("SELECT total_entries, total_size FROM snapshots WHERE snapshot_date = %(d)s")
    size = q("SELECT sum(size) FROM entries WHERE snapshot_date = %(d)s")[0][0]
    check("registry row exists", len(reg) == 1, f"{len(reg)} row(s)")
    if reg:
        check("registry totals match entries", reg[0][0] == n and reg[0][1] == size,
              f"registry entries={reg[0][0]:,} size={reg[0][1]:,} | entries {n:,} / {size:,}")

    # 4. Directory flag (known issue P4: is_directory guessed per chunk)
    mism = q("SELECT countIf((file_type = 'directory') != (is_directory = 1)) FROM entries WHERE snapshot_date = %(d)s")[0][0]
    check("is_directory agrees with scanner file_type", mism == 0, f"{mism:,} rows disagree", required=False)

    # 5. Aggregations reconcile with raw rows at the root
    files_sum = q("SELECT sum(size) FROM entries WHERE snapshot_date = %(d)s AND file_type != 'directory' "
                  "AND (parent_path = %(r)s OR startsWith(parent_path, %(rp)s))", r=ROOT_PATH, rp=ROOT_PATH + "/")[0][0]
    rec = q("SELECT recursive_size_bytes FROM directory_recursive_sizes WHERE snapshot_date = %(d)s AND path = %(r)s",
            r=ROOT_PATH)
    if rec:
        rel = abs(rec[0][0] - files_sum) / max(files_sum, 1)
        check("recursive size of root == sum of file sizes", rel < 0.001,
              f"recursive={rec[0][0]:,} files={files_sum:,} diff={rel:.4%}", required=False)
    else:
        check("recursive sizes computed", False, "no root row in directory_recursive_sizes")
    vor = q("SELECT size FROM voronoi_precomputed WHERE snapshot_date = %(d)s AND path = %(r)s LIMIT 1", r=ROOT_PATH)
    check("voronoi computed", bool(vor), "root node present" if vor else "no root node")
    if vor and rec:
        rel = abs(vor[0][0] - rec[0][0]) / max(rec[0][0], 1)
        check("voronoi root size == recursive size", rel < 0.001, f"diff={rel:.4%}", required=False)

    # 6. Drift vs the previous full snapshot (catches partial imports)
    if a.previous:
        prev = dict(ch.execute("SELECT splitByChar('/', path)[4] AS src, count() FROM entries "
                               "WHERE snapshot_date = %(p)s AND startsWith(path, '/project/cil/') GROUP BY src",
                               {"p": a.previous}))
        for src in EXPECTED_SOURCES:
            old, new = prev.get(src, 0), by_src.get(src, 0)
            drift = abs(new - old) / max(old, 1)
            check(f"drift vs {a.previous}: {src}", drift <= a.max_drift, f"{old:,} -> {new:,} ({drift:+.1%})",
                  required=False)

    failed = [r for r in results if r[0] == "FAIL"]
    warned = [r for r in results if r[0] == "warn"]
    print(f"\n{len(results) - len(failed) - len(warned)} passed, {len(warned)} warnings, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
