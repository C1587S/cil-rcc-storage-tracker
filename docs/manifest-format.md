# Housekeeping manifest & receipt format (v1)

The contract between the housekeeping panel (which generates manifests from
decisions) and the executor (a Rust binary each file owner runs themselves).
The canonical type definitions live in `scanner/crates/manifest-types/` —
the Python writer in `apps/api/app/housekeeping/manifests.py` must stay in
sync with them; bump `FORMAT_VERSION` in both together.

## Why it looks like this

- **One manifest = one owner.** No service account can unlink other users'
  files on RCC, so execution is per-owner by construction. The executor
  refuses to run if the invoking uname doesn't match `owner_uname`.
- **The manifest is the complete set of paths.** The executor does no
  recursion, no globbing, follows no symlinks, and refuses any entry that
  resolves outside `root`. If it isn't in the file, it doesn't get touched.
- **Entries carry `size_bytes` and `mtime_epoch` from the snapshot the
  decision was reviewed against.** The executor stats every path first and
  skips (and reports) anything that changed — a file modified after review
  is not the file that was reviewed. `mtime_epoch` is whole seconds
  (that's what the scanner records); compare seconds, not nanoseconds.
- **Entries carry `inode`** so the executor can detect hardlink groups
  within the manifest and count freed bytes once per inode, and report
  `nlink > 1` cases in the receipt.

## Executor behavior (design constraints, in priority order)

1. Runs as the file owner; pre-flight refuses non-owned paths outright.
2. Dry-run is the default; acting requires `--quarantine` or `--purge`.
   Dry-run emits the identical receipt, minus the filesystem changes.
3. Verify size+mtime per entry before touching it (see above).
4. No symlink following / recursion / globbing; confined to `root`.
5. Bounded parallelism, tunable via `--workers` (default conservative,
   16 — unlink storms degrade the metadata servers for the whole cluster).
6. Files first; then empty directories bottom-up. `rmdir` only — never a
   recursive remove.
7. Default action is rename-into-quarantine (same-filesystem rename:
   instant, reversible, frees nothing). `--purge` unlinks for real and can
   be pointed at an expired quarantine tree.
8. Emits a JSON receipt; uploading it to the panel creates the execution
   row automatically and becomes the second measurement against passive
   snapshot verification.

Quarantine layout: `<root>/.hk-quarantine/<owner>/<manifest_id>/<path
relative to root>`, preserving structure so restores are a reverse rename.

Operational notes:
- `/cds3/cil` is not mounted on compute nodes — cds3 manifests must run on
  a login node, not through Slurm. `/project/cil` manifests can be Slurm
  jobs.
- Quarantine on cds3 is near-useless while the tier sits at 100% (a rename
  frees nothing and the goal there is headroom) — expect `--purge` to be
  the normal cds3 action, after review.

## Manifest JSON (v1)

```json
{
  "version": 1,
  "manifest_id": "hk-t42-emvargas-20260913-a1b2c3",
  "snapshot_date": "2026-09-12",
  "root": "/cds3/cil",
  "owner_uname": "emvargas",
  "decision_ids": [17],
  "target_ids": [42],
  "quarantine_dir": "/cds3/cil/.hk-quarantine/emvargas/hk-t42-emvargas-20260913-a1b2c3",
  "generated_at": "2026-09-13T06:41:00Z",
  "generated_by": "cadavidsanchez",
  "total_bytes": 21181967153881,
  "total_files": 1098102,
  "entries": [
    {
      "path": "/cds3/cil/backups/x/y.nc",
      "path_hash": "1234567890123456789",
      "size_bytes": 104857600,
      "mtime_epoch": 1745833200,
      "inode": 8857903,
      "decision_id": 17
    }
  ]
}
```

`path_hash` is ClickHouse `cityHash64(path)` as a decimal string (u64
exceeds safe JSON integers).

## Receipt JSON (v1)

```json
{
  "version": 1,
  "manifest_id": "hk-t42-emvargas-20260913-a1b2c3",
  "executor": "emvargas",
  "action": "quarantine",
  "dry_run": false,
  "started_at": "2026-09-14T02:00:11Z",
  "finished_at": "2026-09-14T02:19:47Z",
  "outcomes": [
    { "path": "/cds3/cil/backups/x/y.nc", "outcome": "quarantined", "nlink": 1 }
  ],
  "bytes_freed": 20991167153881,
  "files_removed": 1091344,
  "files_skipped_changed": 6740,
  "files_skipped_missing": 18,
  "files_failed": 0,
  "dirs_removed": 4171
}
```

Outcomes: `quarantined | deleted | skipped_changed | skipped_missing |
failed` (with `errno`). `bytes_freed` counts each inode once.

Upload: `POST /api/housekeeping/receipts` with the receipt as the body and
`X-User` set — creates the execution rows (one per decision id in the
manifest), stores the receipt in object storage, and appends the audit
event. Nobody clicks "I did it".
