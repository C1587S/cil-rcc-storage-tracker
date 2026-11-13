# Technical roadmap

Goal: a secure, reliable, low-cost HPC storage analytics service with
trustworthy data, automated reporting, and a useful dashboard. It should
eventually be owned by the Climate Impact Lab rather than a personal account.

## Status (2026-11-13)

| Stage | Status |
|---|---|
| 1. Security and operational reliability | **Done and deployed**: server-side operator key, least-privilege ClickHouse accounts, localhost-only ports, executor token rotated, TLS pinning for RCC, rate limits, working backups with restore checks ([security.md](security.md)) |
| 2. Restore periodic reporting | **In progress**: chains rebuilt on `scanner/scripts/lib/chain.sh` (resubmit first, dedup, overlap guard, finalize gate, staleness mail). Fresh scan running on Midway3. Publishing and computing chains to be restarted. Cadence decided: storage scans **weekly** (`CIL_SCAN_INTERVAL_DAYS=7`, publish staleness alarm at 8 days) plus on-demand manual scans; computing reports **daily or more often** (15-minute chain). Follow-up: align the workstation staleness warning and the dashboard freshness badge with the weekly cadence |
| 3. Data integrity | Planned: partial 09-18 snapshot, stale `computing.*` copies 09-13..11-13, directories counted as files, summing-view double counts, Voronoi mis-parenting, registry totals, idempotent imports (`PARTITION BY snapshot_date` + replace) |
| 4. Scanner performance and reliability | Planned: one bounded thread pool, `lstat`, prune-before-descend resume, error sidecar, `blocks`/`nlink`/`dev`/`kind` columns. Measure before and after |
| 5. Query performance | Measured ([performance.md](performance.md)). Voronoi filter-then-join implemented (9–10×, identical results), to deploy after the next import. Next: sort-key subtree filters (11–27×), import-time rollups |
| 6. Low-cost hosting and ownership | Planned (below) |
| 7. BigQuery experiment | Designed, not started ([bigquery-experiment.md](bigquery-experiment.md)) |
| 8. Self-hosted SQL assistant | Designed, not started ([sql-assistant-experiment.md](sql-assistant-experiment.md)): model-driven, in the browser (WebLLM or Transformers.js, small quantized model) for question→SQL, ClickHouse↔BigQuery adaptation, error repair and plain-language explanations; no external AI API or inference server; server-side validation, read-only accounts, limits and cost controls independent of the model |

## Low-cost hosting objective: about $0–10/month

### What the measurements say

- **Traffic:** about 62 dashboard queries/day (peak 177). Almost all of
  them are answerable from per-snapshot aggregates.
- **Data:**
  - One full snapshot is 71M entries: about 1.7 GiB in ClickHouse
    (compressed), 2.6 GB as Parquet, about 27 GiB uncompressed.
  - The derived Voronoi data is the largest table (7.7 GiB for 4
    snapshots) and can shrink a lot (see performance.md §4).
- **Compute:** idle stack about 3 GB RAM. Imports peak at about 11 GB, but
  they run once per scan and need not run on the serving host.
- **Implication:** an always-on VM sized for imports is the wrong shape.
  Serving needs little and can scale to zero. Imports can run elsewhere
  (a workstation, an RCC job, a short-lived container).

### Options

| Option | Serving | Data / queries | Est. monthly cost | Custom SQL | Trade-offs |
|---|---|---|---|---|---|
| A. Status quo (personal workstation + tunnel) | always on | ClickHouse | $0 cash, personal machine | full | Single person's machine; not institutional |
| B. Small VM + ClickHouse | always on | ClickHouse | about $4–10 (e.g. 4–8 GB ARM VM) | full | Must import elsewhere and ship data; OS patching |
| C. Serverless API + BigQuery | scale to zero (e.g. Cloud Run) | BigQuery, partitioned by snapshot, clustered by path | likely $0–3 within free tiers if scans are capped | BigQuery dialect (or translated) | Per-query scan billing must be capped; dialect change |
| D. Static site + precomputed files | static hosting / object storage | per-snapshot rollups + Voronoi JSON; optional in-browser SQL (DuckDB-WASM over Parquet) | about $0 | in-browser, slower | Whatever is published is public unless gated |
| E. Institutional hosting | UChicago IT Services / RCC | either | possibly $0 to the lab | full | Depends on their offering and support model |

Free tiers and prices change. Re-check before committing, and see the
experiment document for the figures used (2026-11).

### Recommended direction (to be validated, not decided)

1. **Precompute first, whatever the backend.** Import-time rollups
   (performance.md §3) and a slimmer Voronoi table make every option
   cheaper. They also keep the dashboard fast on small hardware or
   pay-per-scan engines.
2. **Separate import from serving.** Run imports where the data and CPU
   are (workstation or RCC job). The serving tier only receives finished
   per-snapshot tables or files.
3. **Evaluate C (BigQuery + scale-to-zero API) against B (small VM +
   ClickHouse)** with the same benchmark harness and real query corpus.
   Decide on measured latency, cost under capped quotas, and SQL-console
   compatibility.
4. **Ownership:** create the hosting account, billing and DNS under the
   lab (or UChicago IT), not personal accounts. Transfer the GitHub
   repository to the Climate Impact Lab organization. That step needs a
   review of what is public (see below) and of where secrets live.

### Before the repository moves (or stays public)

The GitHub repository is public. Nothing secret is committed. However, the
code contains an RCC username in report URLs and defaults, and the
published RCC scans are world-readable. Decide whether the lab repository
should be private, and move the URLs and defaults into configuration.

### Deliverables still to prepare (later milestone)

- An infrastructure report: measured resources (this file and
  performance.md), the option comparison above with re-checked prices,
  data sensitivity, and maintenance needs.
- An email draft to UChicago IT Services asking about institutional
  hosting, cloud billing for a lab project, and long-term maintenance.
