# BigQuery backend experiment (design, not started)

**Question:** can the dashboard run on BigQuery behind a scale-to-zero API,
for about $0–10/month, without losing features (especially the custom SQL
console) and with acceptable latency?

This is a future milestone. Nothing here changes production. All work
happens on a branch, `experiment/bigquery-backend`, against a separate GCP
project owned by the lab.

## 1. Data: synthetic and anonymized, never raw paths

Real paths, file names and usernames must not leave the lab's controlled
systems for the experiment. Two datasets:

- **Synthetic:** generated from the statistics of a real snapshot.
  - Directory fan-out and depth distribution.
  - Files per directory.
  - The size distribution (heavy tail), and extension and owner
    frequencies.
  - mtime/atime distributions.

  Scale it to 1× and 3× of a real snapshot (71M and 210M rows) to test
  growth.
- **Anonymized real structure:**
  - Each path component is replaced by a keyed HMAC (secret key held by
    the lab) and owners by stable pseudonyms.
  - Sizes, times, depth and the tree shape are kept, so query
    selectivity matches reality.
  - Extensions are kept, since they carry no identity.

Both are produced from the existing Parquet files by one script, with the
same schema as `filesystem.entries`. Check: aggregate totals per depth and
owner rank must equal the original.

## 2. Backend portability

Today the API calls ClickHouse directly from routers and services. The
experiment introduces a thin backend interface: execute a parameterized
query and return rows plus stats. A dialect layer sits on top of it, so
the same features run on both engines. ClickHouse-specific constructs in
use, and their BigQuery equivalents:

| ClickHouse | BigQuery |
|---|---|
| `startsWith(s, p)` | `STARTS_WITH(s, p)` |
| `positionCaseInsensitive(h, n) > 0` | `STRPOS(LOWER(h), LOWER(n)) > 0` |
| `arrayJoin(…)` | `UNNEST(…)` |
| `argMax(x, y)` | `ARRAY_AGG(x ORDER BY y DESC LIMIT 1)[OFFSET(0)]` / `MAX_BY` |
| `uniqExact(x)` / `uniq(x)` | `COUNT(DISTINCT x)` / `APPROX_COUNT_DISTINCT(x)` |
| `quantile(p)(x)` | `APPROX_QUANTILES(x, 100)[OFFSET(p*100)]` |
| `JSONExtractArrayRaw` | `JSON_EXTRACT_ARRAY` |
| `splitByChar(c, s)` | `SPLIT(s, c)` |
| `formatReadableSize` | UDF or format in the API |
| `PARTITION BY` / `ORDER BY` key | `PARTITION BY snapshot_date CLUSTER BY parent_path, path` |
| `FINAL`, `ReplacingMergeTree` | write each snapshot once (`WRITE_TRUNCATE` on the partition) |

The precomputed per-snapshot tables (performance.md §3) remove most
engine-specific SQL from the hot paths.

## 3. Custom SQL console compatibility

Users write ClickHouse SQL today. Options, to be evaluated in this order:

1. **Transpile** ClickHouse to BigQuery (e.g. with sqlglot). Measure
   fidelity on the real corpus of console queries from
   `system.query_log` (normalized, with literals stripped). Success: at
   least 95% transpile and return results equal to ClickHouse on the
   anonymized dataset.
2. **Native BigQuery SQL** in the console on that backend, with the
   NL-to-SQL prompt switched to the BigQuery dialect. This is simpler but
   changes the user-facing language.
3. Keep ClickHouse for the console only (hybrid), if neither is
   acceptable.

Guardrails on BigQuery:
- A read-only service account with `bigquery.dataViewer` on the dataset
  and `jobUser`.
- `maximum_bytes_billed` on every query.
- A per-day custom quota.

## 4. Performance protocol

Reuse `scripts/bench/bench_read_paths.py`. Add a BigQuery runner for the
db layer that records time, bytes processed and slot-ms. Run the same
features, size classes and repeats on:
- ClickHouse (current host);
- BigQuery on-demand, cold and with the result cache disabled.

Report p50/p95 per feature and bytes billed per feature.

Acceptance (initial proposal):
- The Explorer and the precomputed views are under 1 s p95.
- Voronoi subtree is under 2 s p95.
- Whole-root console aggregates are under 10 s.
- No feature is lost.

## 5. Cost model (prices as found 2026-11; re-check before spending)

- **Query:** on-demand about $6.25/TiB processed after the first 1 TiB per
  month, which is free. There is a 10 MB minimum per table referenced.
- **Storage:** logical (uncompressed) about $0.02/GiB-month, or physical
  (compressed) about $0.04/GiB-month. Per the third-party sources found,
  the first 10 GiB per month may be free; this was not confirmed on
  Google's page.
- **Serving:** Cloud Run request-based free tier: about 2M requests,
  180k vCPU-s and 360k GiB-s per month per billing account.

Estimate with today's data. These figures are to be replaced by
measurements:
- **Storage:** keeping 2 full snapshots (about 27 GiB logical each) plus
  per-snapshot rollups comes to about 55 GiB logical (about $1/month), or
  a few GiB physical.
- **Queries:**
  - A whole-snapshot scan of `path` is about 11 GiB, so the 1 TiB free
    tier allows about 90 such console queries a month before charges.
  - Precomputed dashboard views and clustered subtree queries scan
    megabytes.
  - With `maximum_bytes_billed` and a daily quota, the worst case is
    bounded, e.g. a 50 GiB/day cap is under $10/month even if hit daily.
- **Serving:** at about 62 queries/day, well inside the free tier.

## 6. Milestones and exit criteria

1. Anonymized and synthetic datasets plus the equality checks.
2. Backend interface in the API, with ClickHouse behind it and no
   behavior change. Merged only if the existing tests and benchmark are
   unchanged.
3. BigQuery tables, the load job and capped service account.
4. Benchmark and cost run on both backends; console transpile fidelity
   report.
5. Decision memo: adopt, hybrid, or stay on ClickHouse. The branch is
   merged only if it meets the acceptance criteria at the target cost.
