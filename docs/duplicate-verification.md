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

- **Read-only.** Candidates are opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`
  (a path swapped for a FIFO cannot hang the open). `O_NOATIME` is used where the
  kernel allows it (owner only), so verification does not make cold files look
  recently used to atime-based age analysis; opens without it are counted
  (`opened_without_noatime`).
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
- **Settle window.** Files whose mtime or ctime is less than `--settle-secs` old
  (default 600) are skipped as `recently_changed`: they may still be being written,
  and with whole-second timestamps a write in the same second as the stat would be
  invisible to the identity checks and to the cache key.
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
  early and can be resumed. Resuming is refused when scope settings differ from the
  ones recorded in `run-config.json` (prefix, sampling, limits, settle window), so a
  group completed under a narrower scope is never skipped by accident. A line left
  torn by a crash (`kill -9`, node failure) is terminated on the next start, readers
  skip it, and that group is redone.
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
  - `recently_changed`

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

Inspect the outputs without any database (standard library; runs on RCC too). It
prints counts only unless `--show-paths`:

```bash
python3 scripts/dupverify/summarize_results.py --out ~/dupverify/cand_pilot --recheck
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
| `--settle-secs` | 600 |
| `--cache FILE` | none |
| `--no-resume` | off |
| `--plan` | estimate only, no file access |

## Production schema (not applied)

`clickhouse/schema/06_duplicate_verification.sql` creates four tables. The compose
init uses its own inline schema and never reads this file, so nothing applies it
automatically. Until it is applied, the Content-verified view says that no
verification has been imported, and the API answers `available: false`.

| Table | One row per | Holds | Engine / key |
|---|---|---|---|
| `dupverify_runs` | verification run | settings, outcome (`stopped`), group counts, bytes read, elapsed, skip-reason counts | ReplacingMergeTree, `ORDER BY run_id` |
| `dupverify_groups` | group × run | status, common directory, files, inodes examined, duplicate sets, bytes read, note. The latest row per group is authoritative | ReplacingMergeTree, monthly partitions, `ORDER BY (snapshot_date, group_id, run_id)` |
| `dupverify_files` | path in a verified set (complete groups only) | BLAKE3, byte-verified flag, copies, device, inode, nlink, allocated bytes, sparse flag, verified mtime/ctime, path, owner | as above, `+ (set_blake3, path)` |
| `dupverify_skipped` | file not compared | path, reason | as above, `+ path` |

Files that were compared and found unique are not stored.

**Storage.** Measured with ClickHouse 24.1 on synthetic rows whose paths match the
real average length for these candidates (176 characters):

| Table | Bytes per row on disk |
|---|---:|
| `dupverify_files` | 74 |
| `dupverify_skipped` | 15 |
| `dupverify_groups` | 9.5 |

Real paths may compress less well, so allow 2×:

| Scope | Worst case (every file recorded) |
|---|---:|
| Small pilot (40 groups, 157 files) | under 50 KB |
| ≥ 1 GiB (3,215 groups, 15,949 files) | under 3 MB |
| ≥ 100 MiB (58,431 groups, 443,695 files) | under 80 MiB |

For comparison, one snapshot of `entries` is several GiB. Re-verification adds history
rows (there is no TTL).

**Migration safety.**
- The file contains only `CREATE TABLE IF NOT EXISTS` on four new names. It has no
  `ALTER`, `DROP`, `INSERT` or materialized view, and doesn't touch existing tables,
  partitions or merges.
- It is idempotent, needs no restart, and requires only that the `filesystem` database
  exists.
- No grants change. `tracker_api` already has `SELECT` on `filesystem.*`, and only the
  importer, through the admin account like the snapshot importer, writes.
- The deployed API has no endpoints for these tables until this branch is deployed, so
  applying the schema alone changes nothing visible.

Pre-check:

```bash
docker compose exec -T clickhouse clickhouse-client --readonly=1 -q \
  "SELECT name FROM system.tables WHERE database = 'filesystem' AND name LIKE 'dupverify%'"
```

It should print nothing.

Apply (needs approval):

```bash
docker compose exec -T clickhouse clickhouse-client --multiquery < clickhouse/schema/06_duplicate_verification.sql
```

Then verify: the pre-check should list the four tables.

Rollback drops only these four tables:

```bash
docker compose exec -T clickhouse clickhouse-client --multiquery <<'SQL'
DROP TABLE IF EXISTS filesystem.dupverify_skipped SYNC;
DROP TABLE IF EXISTS filesystem.dupverify_files SYNC;
DROP TABLE IF EXISTS filesystem.dupverify_groups SYNC;
DROP TABLE IF EXISTS filesystem.dupverify_runs SYNC;
SQL
```

The source of truth stays in the private output directories (`results.jsonl` and
summaries), so everything can be re-imported after a rollback.

## Staying valid as files change

A verified set describes files as they were when read. Its validity is tracked in
layers. None of them ever produces a deletion action or a manifest.

1. **Version recorded.** Each verified inode stores device, inode, size, mtime_ns and
   ctime_ns, and each group its verification time. Every set shows its verified date.
2. **Snapshot check (automatic, metadata only).** Each `/sets` response compares every
   copy with the latest snapshot: same path, size, inode and mtime in seconds.
   - If any copy changed or is missing, the set is marked **re-verify** and its copies
     cannot be selected from the verified view.
   - Agreement means "no sign of change", not a new proof: the snapshot has no ctime,
     and a copy made with preserved mtime can still differ.
3. **Live recheck (stat only, no content read).** `summarize_results.py --recheck`
   compares the full recorded version, including ctime, which users cannot set, with
   `lstat` now.
4. **Re-verification.** Exporting the same scope from a newer snapshot gives new group
   ids; a run over them supersedes the old results. Through the digest cache,
   unchanged files (same device, inode, size, mtime and ctime) cost no reads, and only
   changed files are read again.
5. **Decisions.** A verified set is evidence for reviewers. Targets made from it go
   through the unchanged Housekeeping review, manifest, receipt and audit flow.
   Reviewers should only act on sets that are consistent with the current snapshot and
   recently verified. Checks at execution time remain the executor's own and are not
   affected.

## Tests

| Suite | Covers |
|---|---|
| `cargo test -p dupverify` | 33 tests on synthetic fixtures. Content: identical content under different names; same name and size with different content; identical samples but different elsewhere. File kinds: hard links (inside and outside the set), symlinks, directories, missing files, zero-byte files, 64 MiB sparse files. Runtime behaviour: budget stop then resume; in-place modification and growth during hashing; `chmod 000`; interrupt then resume without rereading finished groups; cache reuse and invalidation (identical rewrite with the mtime restored still invalidates via ctime). Limits and outputs: groups of 15 files (12 identical); byte verification; prefix scoping on path-component boundaries; deferral; 0600/0700 outputs; candidates unchanged after a run. After review: settle window, recorded versions, recovery from a torn last line after a crash, refusal to resume under a different scope, a failing byte-verify reference charged to itself, and a FIFO open that does not block. |
| `scripts/tests/dupverify_e2e_test.sh` | 31 checks against a throwaway ClickHouse container: export, verify, the offline summary (recheck, independent byte check, file modes), import, idempotent re-import, a budget-stopped run, the API's own SQL, a file rewritten after verification, and a newer snapshot that disagrees with one set. |
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

## Pilot 0: a small RCC run (prepared, not submitted)

Pilot 0 needs no production schema change and imports nothing. Its outputs stay in a
private directory and are inspected with `summarize_results.py`.

| | |
|---|---|
| Scope | 2026-11-13 snapshot, files 100 MiB–1 GiB, groups of ≤ 4 files, top 40 groups |
| Size | 157 files, 5 owners, 7 top-level directories |
| Limits | 1 worker, 25 MiB/s, 5 GiB total read, 30 min walltime, 2 CPUs, 2 GB, account and partition `cil` |
| Reads | samples ≤ 49.1 MiB (51,445,760 bytes), plus full reads only where samples collide; hard cap 5 GiB (about 3.5 min at the rate cap). Worst case without the cap would be 133.7 GiB |
| Writes | `~/dupverify/pilot0/` (0700) and the clone's `slurm_out/` (0700) only |

### Preflight checklist

`scanner/scripts/dupverify_pilot_check.sh pre` checks each item and prints PASS, WARN
or FAIL. It is read-only and never submits anything.

**No interference with scheduled RCC jobs**
- It runs from a separate clone, pinned to the reviewed commit, with no local changes.
  The checkout used by the chains is neither used nor modified; `post` compares its
  HEAD and status with the preflight snapshot.
- The pilot script never calls `sbatch` and has no `--dependency`/singleton.
- Its job name, `cil_dupverify`, is not used by any chain script, and no pilot job is
  already queued.
- It warns if one of your scheduled jobs starts within 45 min. The pilot uses 2 CPUs
  for at most 30 min.
- It writes nothing under `/scratch/.../cil_scans`, `public_html` or shared project
  trees.
- `post` confirms every job queued before the pilot is still queued.

**Paths stay private**
- `~/dupverify` and `~/dupverify/pilot0` are 0700, and the candidate file is 0600 and
  owned by you.
- The candidate file's checksum matches the workstation export. It travels only over
  SSH (`scp -p`).
- The output directory is new (created 0700). The log directory is 0700 and the umask
  is 077, so Slurm creates the job logs 0600.

**No output or job log exposes file names or paths**
- The plan output contains no paths.
- `post` runs a leak check on both job logs, the Slurm job record, and the summary
  report. It counts occurrences of every candidate path, every directory name below the
  project root, and every distinctive file name, and requires zero.
- Logs, `sacct` and failure mail carry counts, the job name and state only. Process
  arguments and the job record show only home-directory paths.

**Accepted residual effects**
- Files not owned by the job user are read without `O_NOATIME`, so their atime may
  update; `opened_without_noatime` reports how many. The tracker's age analysis uses
  mtime.
- Reads appear in normal GPFS I/O accounting.
- `results.jsonl` necessarily contains paths; it stays 0600 and is never imported
  without approval.

### Commands

**Workstation**, in the feature-branch checkout. The export is read-only against
ClickHouse and only counts are printed:

```bash
umask 077
mkdir -p ~/dupverify/pilot0 && chmod 700 ~/dupverify ~/dupverify/pilot0
python3 scripts/dupverify/export_candidates.py --date 2026-11-13 \
    --min-size 100M --max-size 1G --skip-groups-over 4 --max-groups 40 \
    --out ~/dupverify/pilot0/cand_pilot0.jsonl
(cd scanner && cargo build -q --release -p dupverify)
scanner/target/release/cil-dupverify --input ~/dupverify/pilot0/cand_pilot0.jsonl --plan
#   expect "groups": 40, "files": 157, "largest_group": 4, "sample_bytes_max": 51445760
stat -c '%a %n' ~/dupverify ~/dupverify/pilot0 ~/dupverify/pilot0/cand_pilot0.jsonl   # 700 700 600
sha256sum ~/dupverify/pilot0/cand_pilot0.jsonl          # keep this value for EXPECT_SHA256
```

**Transfer** (SSH only):

```bash
ssh midway3.rcc.uchicago.edu 'umask 077; mkdir -p ~/dupverify/pilot0; chmod 700 ~/dupverify ~/dupverify/pilot0'
scp -p ~/dupverify/pilot0/cand_pilot0.jsonl midway3.rcc.uchicago.edu:dupverify/pilot0/
```

**Midway3 login node.** This is an isolated clone pinned to the reviewed commit:

```bash
umask 077
git clone --branch feature/content-verified-duplicates --single-branch \
    git@github.com:C1587S/cil-rcc-storage-tracker.git ~/cil-dupverify-pilot
cd ~/cil-dupverify-pilot && git checkout --detach <REVIEWED_SHA>
rustc --version                                          # recent stable (1.80 or newer)
export CARGO_TARGET_DIR=/scratch/midway3/$USER/cargo-target-dupverify
(cd scanner && nice cargo build --release -p dupverify)
export DUPV_BIN=$CARGO_TARGET_DIR/release/cil-dupverify
mkdir -m 700 -p slurm_out
export PROD_CHECKOUT=<path of the checkout the scheduled chains run from>
export EXPECT_SHA=<REVIEWED_SHA> EXPECT_SHA256=<value from the workstation>
bash scanner/scripts/dupverify_pilot_check.sh pre        # must end with "RESULT: no failures"
```

**Submit** once, from the same shell. The account and partition are passed explicitly.
The script header also requests `cil`/`cil`, but `SBATCH_ACCOUNT` or `SBATCH_PARTITION`
in the environment would take precedence over the header; command-line options take
precedence over both. The preflight reports such variables, and the postflight checks
the account and partition `sacct` recorded.

```bash
sbatch --account=cil --partition=cil --time=00:30:00 --mem=2G --cpus-per-task=2 \
  --export=ALL,CANDIDATES=$HOME/dupverify/pilot0/cand_pilot0.jsonl,OUT=$HOME/dupverify/pilot0/out,DUPV_BIN=$DUPV_BIN,DUPV_WORKERS=1,DUPV_MAX_READ_MIB_S=25,DUPV_BUDGET_GIB=5 \
  scanner/scripts/dupverify_pilot.sh
squeue -u $USER -n cil_dupverify                         # watch only this job
#   to abort: scancel <jobid>   (only this id; it stops cleanly and can be resumed)
```

**Validate.** Use the same shell, or re-export `DUPV_BIN` and `PROD_CHECKOUT` first:

```bash
cd ~/cil-dupverify-pilot && umask 077
bash scanner/scripts/dupverify_pilot_check.sh post <jobid>     # must end with "RESULT: no failures"
cat ~/dupverify/pilot0/summary-check.json                       # counts only: safe to share
# only if verified_sets > 0: an independent byte check (at most 2 GiB) on a compute node
srun --account=cil --partition=cil --time=00:15:00 --mem=1G --cpus-per-task=1 \
  python3 scripts/dupverify/summarize_results.py --out ~/dupverify/pilot0/out \
  --spot-check 2 --spot-check-max-mib 2048
```

`post` checks:
- the job state (COMPLETED, or exit 3, which means it stopped at the budget and can be
  resumed);
- that logs and the job record are free of paths and names;
- output modes;
- that all 40 groups are accounted for;
- bytes read ≤ 5 GiB, and a read rate ≤ 25 MiB/s;
- that the recheck reports every verified path unchanged;
- that the scheduled jobs and the production checkout are as before.

Share the `post` output and the two JSON reports; they contain counts only. Keep
`results.jsonl` private. To look at paths, use `summarize_results.py --show-paths
2> private-file` locally.

Optional cleanup after review:
- `rm -rf /scratch/midway3/$USER/cargo-target-dupverify`;
- later, `rm -rf ~/cil-dupverify-pilot`.

Keep `~/dupverify/pilot0` until the results have been reviewed.

**Pilot 1 (after pilot 0 is reviewed).** Larger scope (≥ 1 GiB, top 500 groups),
4 workers, 200 MiB/s, 200 GiB budget, 4 h. The production schema can be applied first if
the results are to be shown in Housekeeping.

Open questions for the pilots:
- whether `O_NOATIME` and `fadvise` behave as expected on GPFS (see
  `opened_without_noatime`);
- which account's read permissions the job should run under;
- whether RCC prefers a specific partition or QoS for I/O-bound jobs.
