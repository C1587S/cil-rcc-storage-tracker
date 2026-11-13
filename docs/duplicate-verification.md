# Content-verified duplicate detection

**Status:** implemented and tested on synthetic data. Nothing has run on RCC yet, and the
ClickHouse tables are not created in production. Both need approval; see
[Pilot proposal](#pilot-proposal).

## Two kinds of evidence

| | Probable | Verified |
|---|---|---|
| Source | weekly metadata snapshot | explicitly requested `cil-dupverify` run |
| Match | same basename and byte size (`/recon/duplicates`) | identical full content (BLAKE3, optionally byte-compared) |
| Contents read | never | yes, read-only |
| Figure shown | "Potential (unverified)": `(copies − 1) × size` | "Potential (upper bound)" for verified copies |

The probable view is still available, and its divergence filter (hiding copies that
split only deep in sibling scenario trees) remains an optional heuristic. Its figure is
not confirmed storage. The April 2026 investigation
([duplicate-detection-investigation.md](duplicate-detection-investigation.md)) hashed
200 name+size candidates and found no true duplicates: model outputs share names,
schemas and sizes but differ in content.

## Pipeline

```
ClickHouse snapshot ──export_candidates.py──▶ candidates.jsonl (0600; real paths)
   group by exact size only, drop singleton sizes,      │
   rank by upper bound, optional --prefix scope         ▼
                                        cil-dupverify (RCC compute node, read-only)
   0  lstat: drop symlinks, non-regular, missing, unreadable, resized files;
      collapse hard links by (device, inode)
   1  spread samples: 5 × 64 KiB from first to last byte (small files hashed whole)
   2  full BLAKE3 only for inodes whose samples collide
   3  optional --byte-verify: byte-for-byte compare against the first copy
                                                        │
                       results.jsonl + summary-<run>.json + hash-cache.jsonl
                                                        ▼
            import_results.py ──▶ dupverify_* tables ──▶ /api/housekeeping/verified-duplicates
                                                        ──▶ Housekeeping › Find › Duplicates › Content-verified
```

Why spread samples: NetCDF/HDF5 outputs of one model share their header. A first-block
prefix check cannot tell them apart and ends up reading every file in full (see
[Benchmarks](#benchmarks)).

The snapshot has no device column, so the export can't collapse hard links. The
verifier does it from `lstat` at read time, and a set whose inode has links outside
the candidate set is flagged `external_links`.

## Safety properties

- **Read-only.** Candidates are opened with `O_RDONLY | O_NOFOLLOW`. `O_NOATIME` is
  used where the kernel allows it (owner only), so verification does not make cold
  files look recently used to atime-based age analysis.
- **Pages dropped after reading.** `posix_fadvise(DONTNEED)` keeps large reads from
  evicting other users' cached data.
- **No actions.** Nothing is modified, moved or deleted, and no deletion action is
  emitted. A verified set only feeds the existing per-copy checkbox, and from there the
  normal target, review, manifest, receipt and audit flow. There is no "select all but
  one" shortcut. Hard links (removing one frees nothing) and copies outside the current
  root are marked.
- **Identity checks around every read.** The file is `fstat`ed when opened and again
  after reading, and device, inode, size, mtime and ctime must all match. Reading one
  byte past the expected size detects growth. A file that changed is reported as
  `changed_during_read` and is never counted as verified.
- **I/O governance**, shared by all workers:
  - a sustained read-rate cap (token bucket, `--max-read-mib-s`);
  - a hard total budget (`--budget-gib`). Once a read would exceed it the run winds
    down;
  - SIGINT/SIGTERM handling.

  Memory stays bounded: candidates are streamed through a bounded channel, and reads
  use fixed buffers (`--read-block-kib`).
- **Resumable.** `results.jsonl` is appended after every group and is also the
  checkpoint. Rerunning with the same `--out` skips groups recorded as complete,
  skipped or deferred, and retries incomplete ones. Exit code 3 means the run stopped
  early and can be resumed.
- **Safe cache reuse.** Digests are reused only for the identical file version,
  matched on device, inode, size, mtime_ns and ctime_ns. Any write, truncate, chmod or
  replacement changes ctime, which users cannot set, so a stale digest is recomputed
  rather than trusted.
- **Explicit non-results.** Every file that did not take part is listed with a reason:
  - `symlink`
  - `not_regular`
  - `missing`
  - `permission_denied`
  - `io_error`
  - `size_changed`
  - `changed_during_read`
  - `zero_size`
  - `budget_exhausted`
  - `interrupted`
  - `out_of_scope`

  Group statuses:
  - `complete`: authoritative.
  - `incomplete`: stopped; nothing in it counts as verified.
  - `deferred`: more files than `--max-group-files`; not read.
  - `skipped`: nothing to compare.
- **Private outputs.** The output directory is created 0700 and files are 0600. Logs
  and stdout carry counts, never paths. Candidate exports and outputs are gitignored.
  Nothing is sent to external services.

## Savings figures

`potential_logical_bytes = (copies − 1) × size` counts distinct inodes only, never
hard links. `potential_allocated_bytes` uses `st_blocks`, so sparse files count what
they actually allocate. Both are **upper bounds**:
- GPFS snapshots, quotas and compression are not modelled;
- links outside the set keep an inode alive;
- results describe files as they were when read, so check the verified date shown
  next to each set.

## Running it

On the workstation, export a scope. This is read-only against ClickHouse; only counts
are printed:

```bash
python3 scripts/dupverify/export_candidates.py --date <snapshot> --min-size 1G \
    --max-groups 500 --out ~/dupverify/cand_pilot.jsonl
scanner/target/release/cil-dupverify --input ~/dupverify/cand_pilot.jsonl --plan   # estimate; reads no files
```

Copy the file to RCC (`scp`, keep it 0600, outside the repo), build, check the plan,
then submit:

```bash
cd scanner && cargo build --release -p dupverify && cd ..
scanner/target/release/cil-dupverify --input ~/dupverify/cand_pilot.jsonl --plan
sbatch --export=ALL,CANDIDATES=$HOME/dupverify/cand_pilot.jsonl scanner/scripts/dupverify_pilot.sh
```

Bring `~/dupverify/cand_pilot/` back and import it. This needs the schema; see below.

```bash
python3 scripts/dupverify/import_results.py --out ~/dupverify/cand_pilot --dry-run
python3 scripts/dupverify/import_results.py --out ~/dupverify/cand_pilot
```

Main flags:

| Flag | Default |
|---|---|
| `--workers` | 2 (the pilot script uses 4) |
| `--max-read-mib-s` | 100 |
| `--budget-gib` | 50 (the pilot script uses 200) |
| `--sample-kib` | 64 |
| `--samples` | 5 |
| `--read-block-kib` | 1024 |
| `--byte-verify` | off |
| `--max-group-files` | 50000 |
| `--prefix DIR` | none (repeatable) |
| `--cache FILE` | none |
| `--no-resume` | off |
| `--plan` | estimate only, no file access |

**Schema.** `clickhouse/schema/06_duplicate_verification.sql` is not applied
automatically; the compose init uses its own inline schema. It adds four new tables and
changes no existing one. Applying it to production needs approval:

```bash
docker compose exec -T clickhouse clickhouse-client --multiquery < clickhouse/schema/06_duplicate_verification.sql
```

Until then, the Content-verified view says that no verification has been imported.

## Tests

| Suite | Covers |
|---|---|
| `cargo test -p dupverify` | 27 tests on synthetic fixtures. Content: identical content under different names; same name and size with different content; identical samples but different elsewhere. File kinds: hard links (inside and outside the set), symlinks, directories, missing files, zero-byte files, 64 MiB sparse files. Runtime behaviour: budget stop then resume; in-place modification and growth during hashing; `chmod 000`; interrupt then resume without rereading finished groups; cache reuse and invalidation (identical rewrite with the mtime restored still invalidates via ctime). Limits and outputs: groups of 15 files (12 identical); byte verification; prefix scoping on path-component boundaries; deferral; 0600/0700 outputs; candidates unchanged after a run. |
| `scripts/tests/dupverify_e2e_test.sh` | Against a throwaway ClickHouse container: export, verify, import, idempotent re-import, a budget-stopped run, and the API's own SQL. |
| `apps/api/tests/test_dupverify.py` | GET-only routes, `available: false` without tables, root validation, response shape and savings, parameterized prefixes, and labels on the probable endpoint. |

## Benchmarks

Synthetic tree from `scripts/bench/dupverify_bench.py`: 2,165 files, 3.13 GiB, 55
size groups and 210 true duplicate sets. Cold page cache, NVMe, 32 cores. "Device" is
measured reads from `ru_inblock`.

| Run | Wall | Bytes read (device) | Sets found |
|---|---:|---:|---:|
| dupverify, 2 workers | 1.04 s | 1,234 MiB (39%) | 210 ✓ |
| dupverify, 8 workers | 0.63 s | 1,234 MiB | 210 ✓ |
| dupverify, 8 workers, `--byte-verify` | 0.98 s | 2,433 MiB | 210 ✓ |
| dupverify, first block only (`--samples 1`) | 1.54 s | 3,098 MiB (99%) | 210 ✓ |
| dupverify, rerun from digest cache | 0.03 s | 0 | 210 ✓ |
| fclones 0.35, default threads | 0.28 s | 1,174 MiB | 210 ✓ |
| fclones, `-t 2` | 0.87 s | 1,174 MiB | 210 ✓ |
| fclones, `-t 8` | 0.38 s | 1,174 MiB | 210 ✓ |

Candidate selection on the live 2026-11-13 snapshot (74.3M rows; read-only; aggregate
counts only):

| Scope | Groups | Files | Upper bound | Full-read upper bound | Export time |
|---|---:|---:|---:|---:|---:|
| ≥ 1 GiB, all groups | 3,215 | 15,949 | 44.6 TiB | 54.6 TiB | 1.3 s |
| ≥ 100 MiB, top 5,000 groups | 5,000 | 325,146 | 114.6 TiB | 124.4 TiB | 4.8 s |
| ≥ 100 MiB, all groups | 58,431 | 443,695 | 129.4 TiB | 151.3 TiB | 50.6 s |

**Decision: keep the custom verifier and use fclones as an independent cross-check.**
- fclones reads about as much (it uses prefix plus suffix hashing; the suffix
  separates same-header outputs much as spread samples do) and is faster on local SSD
  with many threads.
- What decides it is the HPC-safety contract, which fclones does not provide: a total
  read budget, a rate cap, per-group checkpoint and resume, identity rechecks around
  reads, `O_NOATIME`, explicit per-file skip reasons, and structured output for import.
- Wall time on GPFS will be set by the rate cap and the metadata server, not by hashing
  speed.

## Pilot proposal

These are proposed steps, not yet run. Each needs approval.

1. Apply the 06 schema to production ClickHouse. It is additive: four new tables.
2. Export the **≥ 1 GiB scope, top 500 groups by upper bound**, optionally restricted
   to one lab directory with `--prefix`. Check `--plan`.
   - The sample stage reads at most `files × 320 KiB`, about 5 GiB for all 15,949
     files ≥ 1 GiB.
   - Full reads happen only where samples collide. That should be rare, given the April
     result.
3. Submit `dupverify_pilot.sh` once on Midway3:
   - account `cil`, partition `cil`;
   - 4 CPUs, 4 GB, 4 h;
   - 4 workers, **200 MiB/s cap, 200 GiB total budget**.

   At the cap, 200 GiB takes about 17 min. The time limit leaves room for metadata
   latency. It stops cleanly at the budget or 5 min before the limit.
4. Copy the results back, import, and review in Housekeeping:
   - the confirmation rate;
   - bytes read per verified GiB;
   - skip reasons (permission denied is expected outside the job user's groups);
   - incomplete groups.
5. Only then consider wider scopes. If GPFS load is a concern, use a lower cap or an
   off-hours window.

Open questions for the pilot:
- whether `O_NOATIME` and `fadvise` behave as expected on GPFS;
- which account's read permissions the job should run under;
- whether RCC prefers a specific partition or QoS for I/O-bound jobs.
