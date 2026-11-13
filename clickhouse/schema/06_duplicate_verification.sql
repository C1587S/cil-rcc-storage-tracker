-- =====================================================
-- Content-verified duplicate detection (cil-dupverify)
-- =====================================================
-- Results of explicitly requested, read-only verification runs. Nothing
-- here is produced by the weekly metadata scan.
--
-- A group (all candidate files of one exact size within one export scope)
-- may be verified more than once; the authoritative result is the row of
-- dupverify_groups with the latest verified_at, and only files/skips with
-- that same run_id belong to it. Earlier rows are kept as history.
--
-- Statuses: complete (authoritative), incomplete (stopped by budget or
-- interruption: nothing verified), deferred (not attempted), skipped
-- (nothing to compare). Only `complete` groups contribute verified sets.
--
-- "Potential savings" are upper bounds: (copies - 1) * size, and the
-- allocated-blocks variant. Snapshots, quotas, compression and links
-- outside the candidate set (external_links) are not modelled. A verified
-- set is evidence for review, never a deletion instruction.
-- =====================================================

CREATE TABLE IF NOT EXISTS filesystem.dupverify_runs
(
    run_id String,
    snapshot_date Date,
    scope_id String,
    tool String,
    started_at DateTime,
    finished_at DateTime,
    stopped LowCardinality(String),          -- '', 'budget', 'interrupted'
    settings String,                         -- JSON
    groups_complete UInt64,
    groups_incomplete UInt64,
    groups_deferred UInt64,
    groups_skipped UInt64,
    groups_not_attempted UInt64,
    files_in UInt64,
    inodes_examined UInt64,
    duplicate_sets UInt64,
    duplicate_inodes UInt64,
    verified_logical_bytes UInt64,
    verified_allocated_bytes UInt64,
    bytes_read UInt64,
    elapsed_s Float64,
    skipped_by_reason String,                -- JSON {reason: count}
    imported_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(imported_at)
ORDER BY run_id;

CREATE TABLE IF NOT EXISTS filesystem.dupverify_groups
(
    snapshot_date Date,
    scope_id String,
    group_id String,
    run_id String,
    verified_at DateTime,
    size UInt64,
    status LowCardinality(String),
    common_dir String,                       -- deepest directory holding all candidates
    files_in UInt32,
    inodes_examined UInt32,
    unique_inodes UInt32,
    hardlink_paths UInt32,
    duplicate_sets UInt32,
    skipped UInt32,
    bytes_read UInt64,
    note String,
    imported_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, group_id, run_id);

CREATE TABLE IF NOT EXISTS filesystem.dupverify_files
(
    snapshot_date Date,
    group_id String,
    run_id String,
    verified_at DateTime,
    set_blake3 FixedString(64),
    size UInt64,
    byte_verified UInt8,
    copies UInt32,                           -- distinct inodes in the set
    external_links UInt8,
    dev UInt64,
    inode UInt64,
    nlink UInt32,
    allocated_bytes UInt64,
    sparse UInt8,
    mtime_ns Int64,                          -- version verified; compared with later
    ctime_ns Int64,                          --   snapshots and live stat to detect changes
    path String,
    owner String,
    imported_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, group_id, run_id, set_blake3, path);

CREATE TABLE IF NOT EXISTS filesystem.dupverify_skipped
(
    snapshot_date Date,
    group_id String,
    run_id String,
    verified_at DateTime,
    path String,
    reason LowCardinality(String),
    imported_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(imported_at)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, group_id, run_id, path);
