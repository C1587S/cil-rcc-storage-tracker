//! Input (candidate groups) and output (verification results) records.
//! Both are JSON Lines so they can be streamed and appended safely.

use serde::{Deserialize, Serialize};

/// One candidate file, as exported from the metadata snapshot.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct CandidateFile {
    pub path: String,
    #[serde(default)]
    pub owner: Option<String>,
}

/// Files that share an exact byte size in the snapshot (one input line).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct CandidateGroup {
    /// Stable id of the group within a candidate export (resume key).
    pub group_id: String,
    pub size: u64,
    pub files: Vec<CandidateFile>,
    /// The export capped the number of files listed for this group.
    #[serde(default)]
    pub truncated: bool,
}

/// Why a file did not take part in content comparison.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    Symlink,
    NotRegular,
    Missing,
    PermissionDenied,
    IoError,
    /// Current size differs from the snapshot: the file changed since the scan.
    SizeChanged,
    /// Size, mtime, ctime or identity changed while it was being read.
    ChangedDuringRead,
    ZeroSize,
    /// The I/O budget was used up before this file could be verified.
    BudgetExhausted,
    /// The run was interrupted (SIGINT/SIGTERM) before this file was verified.
    Interrupted,
    /// Excluded by --prefix targeting.
    OutOfScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Skipped {
    pub path: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PathEntry {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
}

/// One physical file (device + inode). Several paths = hard links.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InodeEntry {
    pub dev: u64,
    pub ino: u64,
    /// Link count reported by the filesystem. Larger than `paths.len()` means
    /// links exist outside the candidate set.
    pub nlink: u64,
    /// st_blocks * 512: space actually allocated (sparse files allocate less).
    pub allocated_bytes: u64,
    pub sparse: bool,
    pub paths: Vec<PathEntry>,
}

/// Distinct inodes whose full content is identical.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DuplicateSet {
    pub blake3: String,
    /// Every member was also compared byte for byte with the first one.
    pub byte_verified: bool,
    /// Independent copies (distinct inodes), largest allocation first.
    pub inodes: Vec<InodeEntry>,
    pub copies: usize,
    /// (copies - 1) * size: logical bytes held by the extra copies.
    pub potential_logical_bytes: u64,
    /// Allocated bytes of all copies except the largest one. Still an
    /// upper bound: snapshots, quotas and compression are not modelled.
    pub potential_allocated_bytes: u64,
    /// Some inode has links outside this set: removing the listed paths
    /// would not free that inode's space.
    pub external_links: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GroupStatus {
    /// Every eligible file was verified; `duplicate_sets` is authoritative.
    Complete,
    /// Stopped by budget or interruption; nothing in it counts as verified.
    Incomplete,
    /// Not attempted (e.g. more files than --max-group-files).
    Deferred,
    /// Nothing to compare (zero-size, fewer than two eligible inodes, ...).
    Skipped,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct IoCounts {
    pub sample_bytes: u64,
    pub full_bytes: u64,
    pub compare_bytes: u64,
    pub files_opened: u64,
    pub cache_hits: u64,
}

impl IoCounts {
    pub fn total(&self) -> u64 {
        self.sample_bytes + self.full_bytes + self.compare_bytes
    }
    pub fn add(&mut self, o: &IoCounts) {
        self.sample_bytes += o.sample_bytes;
        self.full_bytes += o.full_bytes;
        self.compare_bytes += o.compare_bytes;
        self.files_opened += o.files_opened;
        self.cache_hits += o.cache_hits;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupResult {
    pub group_id: String,
    pub size: u64,
    pub status: GroupStatus,
    pub files_in: usize,
    /// Distinct inodes that took part in comparison.
    pub inodes_examined: usize,
    /// Inodes shown to differ from every other candidate.
    pub unique_inodes: usize,
    /// Extra paths that are hard links to an inode already counted.
    pub hardlink_paths: usize,
    pub duplicate_sets: Vec<DuplicateSet>,
    pub skipped: Vec<Skipped>,
    pub io: IoCounts,
    pub elapsed_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}
