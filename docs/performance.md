# Dashboard and database performance

Baseline measured 2026-11-13 on the production workstation (32 cores,
62 GB RAM, ClickHouse 24.1, snapshot 2026-09-24: 70.9M entries). All
measurements are read-only. Reproduce them with:

```bash
apps/api/venv/bin/python scripts/bench/bench_read_paths.py --repeat 3 --out logs/bench/<name>.json
```

The harness picks its test subtrees by size class (about 1M / 100k / 10k
files) at run time, so it contains no real paths and runs on any snapshot.
It measures two layers:

- **db**: the SQL behind each feature, run as `tracker_api` with the API's
  limits, with no API cache. This is the backend cost and the number to
  compare against other backends.
- **http**: the endpoints end to end. The API caches responses per
  snapshot, so first and repeat calls are reported separately.

## Workload (from `system.query_log`, dashboard queries only)

Dashboard queries are identified by the API's `max_execution_time=20`
session setting. Batch imports are excluded.

| Since 2026-09-01 | Value |
|---|---|
| Queries | 5,622 (about 62/day, peak 177/day) |
| Latency p50 / p95 / p99 | 7 ms / 2.4 s / 6.0 s |
| Timeouts (20 s cap) | 98 |
| Cancelled / row-limit errors | 27 / 3 |

Traffic is very low. Cost is concentrated in a few query shapes. Idle
memory: ClickHouse 1.75 GB, API 0.46 GB, web 0.62 GB, Postgres 0.15 GB.
ClickHouse peaks at about 11 GB during imports. Disk: 26.6 GiB of active
parts for 4 snapshots, about 19 GiB of it in the `filesystem` tables.

## Baseline (db layer, median of 3)

| Feature | Time | Rows read | Read |
|---|---:|---:|---:|
| Snapshots list | 1 ms | 4 | 0 |
| Explorer: children of root | 10 ms | 74k | 11 MiB |
| Search: name contains, whole snapshot | 12 ms | 4.3M | 131 MiB |
| SQL console: bytes by owner, whole root | 102 ms | 70.9M | 1.9 GiB |
| SQL console: top 100 largest files | 654 ms | 70.9M | 11.9 GiB |
| Voronoi node lookup by path | 22 ms | 2.6M | 359 MiB |
| Subtree sum, 1M / 100k / 10k files | 244–323 ms | 60.5M | 9.5 GiB |

End to end (http, first call): Explorer browse 32–55 ms; search 258 ms;
**Voronoi subtree 2.6–3.2 s** (repeats 1–77 ms from the API cache).

## Findings and recommendations

Ranked by user impact. Each item was measured on the live snapshot, and
each rewrite returned **identical results** to the current query.

### 1. Voronoi subtree: filter before the join (10× faster) — query change

- **What:** the subtree query `LEFT JOIN`s `directory_recursive_sizes`
  directly onto `voronoi_precomputed`. With the join in place, ClickHouse
  does not pre-filter the Voronoi table. It reads `original_files_json`
  (6.3 GiB on disk, **79 GiB uncompressed**) for most of the snapshot:
  about 30 GiB per request, p95 14 s. This is the likely source of most of
  the 98 timeouts.
- **Fix:** select the filtered Voronoi rows in a subquery, then join that
  small result.
- **Measured:** 2.3 s → 0.23 s; 29.8 → 2.1 GiB read; same 65 rows.
- **Where:** `apps/api/app/services/voronoi_store.py` (subtree query).
- **Validate:** the harness http "voronoi: subtree" rows. A lower timeout
  count in `query_log`.

### 2. Subtree aggregates: use the sort key (11–27× faster) — query change

- **What:** `entries` is ordered by `(snapshot_date, parent_path, path)`. A
  filter on `path` (prefix) cannot narrow the primary-key range, so every
  subtree query reads the whole snapshot (60–77M rows). Housekeeping
  resolver, recon, archive headroom and subtree sums all have this shape.
- **Fix:** express the subtree through `parent_path`
  (`parent_path = p OR startsWith(parent_path, p || '/')`) and fetch the
  directory row itself (`path = p`) in a separate branch. A single
  `OR path = p` in the same filter disables the index and gives no gain.
- **Measured:**

  | Subtree | Before | After | Rows read |
  |---|---:|---:|---|
  | 1M files | 340 ms | 31 ms | 60.5M → 1.2M |
  | 100k files | 434 ms | 24 ms | 60.5M → 123k |
  | 10k files | 415 ms | 16 ms | 60.5M → 25k |
  | Whole root | 814 ms | 753 ms | unchanged (expected) |

- **Where:** `housekeeping/resolver.py`, `routers/recon.py`,
  `routers/housekeeping.py` (subtree sums).
- **Caution:** the resolver drives deletion manifests. Change it only
  together with tests that compare file sets.

### 3. Whole-root reports: precompute at import — design change

- **What:** recon reports (bytes by owner, by extension, age, largest
  files) read 69–83M rows and take about 5 s each. They are inherently
  full scans, and their answers only change when a snapshot is imported.
- **Fix:** compute them once per snapshot during import into small
  per-snapshot tables. Serve from those; the SQL console still allows any
  ad-hoc query.

### 4. Storage layout — schema change, after a backup

- **`voronoi_precomputed`** (7.7 GiB, the largest table) is ordered by
  `node_id`, so a lookup by path reads 2.6M rows. Order it by
  `(snapshot_date, path)`, partition by snapshot, and store each node's
  file list once (it is duplicated on the `__files__` node).
- **Materialized views** `directory_hierarchy` (223M rows, 3.7 GiB) and
  `directory_sizes` (234M rows, 2.7 GiB) hold more rows than `entries`
  itself (206M). They are close to full copies, and the summing view
  double-counts on re-import. Replace them with per-snapshot tables built
  by `INSERT … SELECT` at import time.
- **`entries`**:
  - `PARTITION BY snapshot_date` instead of month, so a snapshot can be
    dropped or replaced atomically.
  - `LowCardinality(String)` for `owner`, `group_name`, `file_type`,
    `top_level_dir`.
  - ZSTD on `path`/`name`.
  - Drop the bloom-filter index on `path` (246 MiB), which cannot help
    prefix queries.
  - Expected: less disk and faster scans. To be measured before and after.

### 5. Not worth optimizing now

- The import itself (about 20 min per snapshot) and simple lookups (under
  50 ms).
- Search over the whole snapshot (12 ms in the db layer).
- The top-N largest files query (0.65 s). It can be made two-phase later
  if needed.

## Custom SQL compatibility

Changes 1–3 are internal to the API. The SQL console keeps querying
`filesystem.entries` and the other tables directly. Change 4 alters column
types and table layout but not column names, so console queries keep
working. `LowCardinality` columns compare and group exactly like `String`.
Views can preserve old table names if any are retired.

## Order of work

- Items 1–2 are safe code changes. They are deployed with an API rebuild
  (about 3 s downtime) and verified with the harness.
- Items 3–4 change schemas or production data. They need a ClickHouse
  backup first and an explicit go-ahead, and must not run while a scan is
  being published or imported.
