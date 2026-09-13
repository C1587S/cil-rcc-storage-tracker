//! Housekeeping manifest and receipt formats, version 1.
//!
//! The manifest is the COMPLETE set of paths the executor may touch:
//! no recursion outside it, no globbing, no symlink following. The
//! executor verifies each entry's size and mtime against these recorded
//! values before acting — a file modified after the decision was made is
//! not the file that was reviewed, and must be skipped and reported.
//!
//! The Python side (apps/api) writes this format; keep the two in sync by
//! changing `FORMAT_VERSION` and both writers together.

use serde::{Deserialize, Serialize};

pub const FORMAT_VERSION: u32 = 1;

/// One manifest = one owner's chunk of one or more decisions.
/// Executors run as the file owner; a manifest never mixes owners.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Always `FORMAT_VERSION`. The executor must refuse newer versions.
    pub version: u32,
    /// e.g. "hk-t42-emvargas-20260913-a1b2c3"
    pub manifest_id: String,
    /// Snapshot the sizes/mtimes below were recorded from (YYYY-MM-DD).
    pub snapshot_date: String,
    /// Storage root; every entry path must resolve inside it.
    pub root: String,
    /// RCC uname that owns every file in this manifest. The executor
    /// refuses to run if the invoking user does not match.
    pub owner_uname: String,
    /// Decision ids this manifest executes (for the receipt round-trip).
    pub decision_ids: Vec<i64>,
    pub target_ids: Vec<i64>,
    /// Suggested quarantine directory (same filesystem as `root`).
    /// The executor's default action is rename-into-quarantine.
    pub quarantine_dir: String,
    /// Human instructions embedded so the manifest is self-explanatory to
    /// an owner who has never used the tool. Optional for old manifests.
    #[serde(default)]
    pub how_to_run: Vec<String>,
    pub generated_at: String,
    pub generated_by: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub entries: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    /// Absolute path. Must be under `root` after normalization; entries
    /// that resolve elsewhere (symlink tricks) are refused.
    pub path: String,
    /// ClickHouse cityHash64(path), decimal string (u64 exceeds JSON ints).
    pub path_hash: String,
    /// st_size recorded at `snapshot_date`. Must match at execution time.
    pub size_bytes: u64,
    /// st_mtime (epoch seconds) recorded at `snapshot_date`. Must match.
    pub mtime_epoch: i64,
    /// inode recorded at scan time: lets the executor detect hardlink
    /// groups inside the manifest and count freed bytes honestly.
    pub inode: u64,
    pub decision_id: i64,
}

/// Per-path outcome in the receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// Renamed into quarantine (default action).
    Quarantined,
    /// Unlinked for real (--purge).
    Deleted,
    /// size or mtime differed from the manifest — file was NOT touched.
    SkippedChanged,
    /// Path no longer exists.
    SkippedMissing,
    /// Delegate mode: the parent directory is not writable by the invoking
    /// user — the kernel would refuse; an owner (or RCC) must handle it.
    SkippedNoAccess,
    /// Filesystem error; `errno` carries the detail.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptEntry {
    pub path: String,
    pub outcome: Outcome,
    /// Present when outcome == Failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errno: Option<i32>,
    /// st_nlink observed at execution: >1 means unlinking may free nothing.
    pub nlink: u64,
}

/// The receipt closes the loop: uploading it creates the execution row.
/// Its byte accounting is the second measurement to compare against the
/// passive snapshot verification — a mismatch teaches us something
/// (usually hardlinks) instead of starting an argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub version: u32,
    pub manifest_id: String,
    /// Uname that actually ran the executor.
    pub executor: String,
    /// "quarantine" or "purge".
    pub action: String,
    pub dry_run: bool,
    pub started_at: String,
    pub finished_at: String,
    pub outcomes: Vec<ReceiptEntry>,
    /// Bytes freed by the tool's own accounting: sum of sizes for
    /// deleted/quarantined entries, counting each inode ONCE.
    pub bytes_freed: u64,
    pub files_removed: u64,
    pub files_skipped_changed: u64,
    pub files_skipped_missing: u64,
    /// Delegate mode only: parent directory not writable by the executor.
    #[serde(default)]
    pub files_skipped_no_access: u64,
    pub files_failed: u64,
    /// Empty directories removed bottom-up after the file pass.
    pub dirs_removed: u64,
}
