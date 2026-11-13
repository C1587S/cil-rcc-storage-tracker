#!/usr/bin/env python3
"""Read-only benchmark of the dashboard's hot read paths.

Two layers, so results can be compared across backends (ClickHouse now,
BigQuery or others later):

  db   the SQL behind each feature, run directly against ClickHouse as the
       API's least-privilege account (tracker_api) with the API's session
       limits. No API cache, so this is the backend cost. Reports wall time
       and rows/bytes read per query.
  http the API endpoints the web app calls, end to end. The API caches
       responses per snapshot, so the first call and repeats are reported
       separately.

Subtrees are picked at run time by size class (about 1M / 100k / 10k
files) from directory_recursive_sizes, so no real paths live in this file
and results are reproducible on any snapshot. Nothing is written to the
database. Rate-limited endpoints (/api/query, /api/search) are paced to
stay under the limits.

Usage (from the repo root, with the API's venv):
  apps/api/venv/bin/python scripts/bench/bench_read_paths.py \
      [--snapshot YYYY-MM-DD] [--repeat 3] [--layers db,http] [--out FILE.json]

Credentials: CLICKHOUSE_API_PASSWORD is read from .env (never printed).
"""
import argparse
import json
import pathlib
import statistics
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def load_env() -> dict:
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def ch_client(env: dict):
    from clickhouse_driver import Client
    return Client(
        host=env.get("BENCH_CH_HOST", "127.0.0.1"), port=int(env.get("BENCH_CH_PORT", 9000)),
        user=env.get("CLICKHOUSE_API_USER", "tracker_api"),
        password=env.get("CLICKHOUSE_API_PASSWORD", ""), database="filesystem",
        # Same limits the API session uses (the account profile enforces them too).
        settings={"max_execution_time": 20, "max_result_rows": 8000, "max_result_bytes": 80_000_000,
                  "use_query_cache": 0},
    )


def pick_subtrees(ch, snap: str) -> dict:
    """One directory per size class, deterministic for a given snapshot."""
    out = {}
    for label, n in (("1M", 1_000_000), ("100k", 100_000), ("10k", 10_000)):
        rows = ch.execute(
            "SELECT path FROM directory_recursive_sizes WHERE snapshot_date = %(s)s "
            "AND recursive_file_count BETWEEN %(lo)s AND %(hi)s ORDER BY cityHash64(path) LIMIT 1",
            {"s": snap, "lo": int(n * 0.8), "hi": int(n * 1.2)})
        if rows:
            out[label] = rows[0][0]
    return out


def db_cases(root: str, sub: dict) -> list[tuple[str, str, dict]]:
    """(feature, SQL, params): the query shapes the dashboard actually runs."""
    cases = [
        ("snapshots list", "SELECT snapshot_date, total_entries, total_size FROM snapshots ORDER BY snapshot_date DESC", {}),
        ("explorer: children of root (recursive sizes)",
         "SELECT path, recursive_size_bytes, recursive_file_count FROM directory_recursive_sizes "
         "WHERE snapshot_date = %(s)s AND path IN (SELECT path FROM entries WHERE snapshot_date = %(s)s "
         "AND parent_path = %(p)s AND is_directory = 1) ORDER BY recursive_size_bytes DESC LIMIT 1000",
         {"p": root}),
        ("search: name contains, whole snapshot",
         "SELECT path, size FROM entries WHERE snapshot_date = %(s)s AND positionCaseInsensitive(name, %(q)s) > 0 LIMIT 100",
         {"q": "readme"}),
        ("sql console: bytes by owner, whole root",
         "SELECT owner, count(), sum(size) FROM entries WHERE snapshot_date = %(s)s GROUP BY owner ORDER BY 3 DESC LIMIT 50", {}),
        ("sql console: top 100 largest files",
         "SELECT path, size FROM entries WHERE snapshot_date = %(s)s AND is_directory = 0 ORDER BY size DESC LIMIT 100", {}),
        ("voronoi: node lookup by path",
         "SELECT depth, size, file_count FROM voronoi_precomputed WHERE snapshot_date = %(s)s AND path = %(p)s LIMIT 1",
         {"p": root}),
    ]
    for label, p in sub.items():
        cases += [
            (f"subtree sum, {label} files (path prefix)",
             "SELECT count(), sum(size) FROM entries WHERE snapshot_date = %(s)s "
             "AND (path = %(p)s OR startsWith(path, %(pp)s))", {"p": p, "pp": p + "/"}),
            (f"subtree sum, {label} files (parent_path prefix, uses sort key)",
             "SELECT count(), sum(size) FROM entries WHERE snapshot_date = %(s)s "
             "AND (path = %(p)s OR parent_path = %(p)s OR startsWith(parent_path, %(pp)s))", {"p": p, "pp": p + "/"}),
            (f"voronoi subtree rows, {label} files",
             "SELECT node_id, size, depth FROM voronoi_precomputed WHERE snapshot_date = %(s)s "
             "AND (path = %(p)s OR startsWith(path, %(pp)s)) AND depth <= (SELECT depth FROM voronoi_precomputed "
             "WHERE snapshot_date = %(s)s AND path = %(p)s LIMIT 1) + 2 LIMIT 8000", {"p": p, "pp": p + "/"}),
        ]
    return cases


def run_db(ch, snap: str, cases, repeat: int) -> list[dict]:
    results = []
    for feature, sql, params in cases:
        times, rows_read, bytes_read, result, err = [], 0, 0, None, None
        for _ in range(repeat):
            t0 = time.perf_counter()
            try:
                result = ch.execute(sql, {"s": snap, **params})
            except Exception as e:  # report, keep going
                err = str(e).split("\n")[0][:160]
                break
            times.append((time.perf_counter() - t0) * 1000)
            prog = ch.last_query.progress
            rows_read, bytes_read = prog.rows, prog.bytes
        results.append({
            "layer": "db", "feature": feature,
            "median_ms": round(statistics.median(times), 1) if times else None,
            "min_ms": round(min(times), 1) if times else None,
            "rows_read": rows_read, "bytes_read": bytes_read,
            "result_rows": len(result) if result is not None else None,
            # single-row answers are kept so equivalent query variants can be checked
            "single_row": [str(x) for x in result[0]] if result is not None and len(result) == 1 else None,
            "error": err,
        })
        print(f"  db   {feature:62s} {results[-1]['median_ms']!s:>9} ms  "
              f"read {rows_read:>12,} rows {bytes_read / 2**20:>10.1f} MiB" + (f"  ERROR {err}" if err else ""))
    return results


def http_get(base: str, path: str, params: dict) -> tuple[float, int, int]:
    url = f"{base}{path}?{urllib.parse.urlencode(params)}"
    t0 = time.perf_counter()
    with urllib.request.urlopen(url, timeout=60) as r:
        body = r.read()
        code = r.status
    return (time.perf_counter() - t0) * 1000, code, len(body)


def run_http(base: str, snap: str, root: str, sub: dict, repeat: int) -> list[dict]:
    cases = [
        ("explorer: browse root", "/api/browse", {"snapshot_date": snap, "parent_path": root, "limit": 1000}),
        ("explorer: contents of root", "/api/contents", {"snapshot_date": snap, "parent_path": root, "limit": 100}),
        ("voronoi: root node", f"/api/voronoi/node/{snap}/root", {}),
        ("voronoi: subtree of root (depth 2)", f"/api/voronoi/node/{snap}/subtree", {"path": root, "max_depth": 2}),
        ("search: contains 'readme'", "/api/search", {"snapshot_date": snap, "q": "readme", "limit": 100}),
    ]
    for label, p in sub.items():
        cases += [
            (f"explorer: browse {label}-file dir", "/api/browse", {"snapshot_date": snap, "parent_path": p, "limit": 1000}),
            (f"voronoi: subtree {label}-file dir", f"/api/voronoi/node/{snap}/subtree", {"path": p, "max_depth": 2}),
        ]
    results = []
    for feature, path, params in cases:
        times, code, size, err = [], None, 0, None
        for i in range(repeat):
            try:
                ms, code, size = http_get(base, path, params)
                times.append(ms)
            except Exception as e:
                err = str(e)[:160]
                break
            if path == "/api/search":
                time.sleep(1.2)  # stay under 60/min
        results.append({
            "layer": "http", "feature": feature, "status": code, "bytes": size,
            "first_ms": round(times[0], 1) if times else None,
            "repeat_median_ms": round(statistics.median(times[1:]), 1) if len(times) > 1 else None,
            "error": err,
        })
        print(f"  http {feature:62s} first {results[-1]['first_ms']!s:>9} ms  repeat {results[-1]['repeat_median_ms']!s:>8} ms"
              f"  {size / 1024:>8.0f} KiB" + (f"  ERROR {err}" if err else ""))
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snapshot")
    ap.add_argument("--root", default="/project/cil")
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--layers", default="db,http")
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--out")
    a = ap.parse_args()

    env = load_env()
    ch = ch_client(env)
    snap = a.snapshot or str(ch.execute("SELECT max(snapshot_date) FROM snapshots")[0][0])
    sub = pick_subtrees(ch, snap)
    print(f"snapshot {snap}; subtree size classes: {', '.join(sub)} (paths not printed)")
    report = {"snapshot": snap, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "repeat": a.repeat, "results": []}
    layers = set(a.layers.split(","))
    if "db" in layers:
        report["results"] += run_db(ch, snap, db_cases(a.root, sub), a.repeat)
    if "http" in layers:
        report["results"] += run_http(a.api, snap, a.root, sub, a.repeat)
    if a.out:
        pathlib.Path(a.out).write_text(json.dumps(report, indent=2))
        print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
