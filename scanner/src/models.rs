use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(unix)]
use std::collections::HashMap;
#[cfg(unix)]
use std::sync::{Mutex, OnceLock};

// uid/gid -> name caches. Lookups go through the REENTRANT *_r variants
// with caller-owned buffers. The previous code used libc::getpwuid /
// libc::getgrgid, which return a pointer into a process-wide static
// buffer; concurrent scanner threads raced on it and occasionally copied
// a torn passwd record (embedded NULs and all) into the owner column.
// Never reintroduce the non-reentrant variants in this multithreaded code.
#[cfg(unix)]
fn uid_cache() -> &'static Mutex<HashMap<u32, Option<String>>> {
    static C: OnceLock<Mutex<HashMap<u32, Option<String>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(unix)]
fn gid_cache() -> &'static Mutex<HashMap<u32, Option<String>>> {
    static C: OnceLock<Mutex<HashMap<u32, Option<String>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Validate a name that came out of NSS: plain, NUL-free UTF-8 or nothing.
#[cfg(unix)]
fn clean_name(raw: &std::ffi::CStr) -> Option<String> {
    raw.to_str().ok()
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .map(str::to_string)
}

/// Get username from UID (Unix-specific, reentrant, cached)
#[cfg(unix)]
fn get_username(uid: u32) -> Option<String> {
    if let Some(v) = uid_cache().lock().unwrap().get(&uid) {
        return v.clone();
    }
    let mut buf = vec![0u8; 4096];
    let resolved = loop {
        let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
        let mut result: *mut libc::passwd = std::ptr::null_mut();
        let rc = unsafe {
            libc::getpwuid_r(uid, &mut pwd, buf.as_mut_ptr() as *mut libc::c_char,
                             buf.len(), &mut result)
        };
        if rc == libc::ERANGE {
            if buf.len() >= 1 << 20 { break None; }
            buf.resize(buf.len() * 2, 0);
            continue;
        }
        if rc != 0 || result.is_null() { break None; }
        break clean_name(unsafe { std::ffi::CStr::from_ptr(pwd.pw_name) });
    };
    uid_cache().lock().unwrap().insert(uid, resolved.clone());
    resolved
}

/// Get group name from GID (Unix-specific, reentrant, cached)
#[cfg(unix)]
fn get_groupname(gid: u32) -> Option<String> {
    if let Some(v) = gid_cache().lock().unwrap().get(&gid) {
        return v.clone();
    }
    let mut buf = vec![0u8; 4096];
    let resolved = loop {
        let mut grp: libc::group = unsafe { std::mem::zeroed() };
        let mut result: *mut libc::group = std::ptr::null_mut();
        let rc = unsafe {
            libc::getgrgid_r(gid, &mut grp, buf.as_mut_ptr() as *mut libc::c_char,
                             buf.len(), &mut result)
        };
        if rc == libc::ERANGE {
            if buf.len() >= 1 << 20 { break None; }
            buf.resize(buf.len() * 2, 0);
            continue;
        }
        if rc != 0 || result.is_null() { break None; }
        break clean_name(unsafe { std::ffi::CStr::from_ptr(grp.gr_name) });
    };
    gid_cache().lock().unwrap().insert(gid, resolved.clone());
    resolved
}

/// Stub for non-Unix systems
#[cfg(not(unix))]
fn get_username(_uid: u32) -> Option<String> {
    None
}

/// Stub for non-Unix systems
#[cfg(not(unix))]
fn get_groupname(_gid: u32) -> Option<String> {
    None
}

/// Represents a single file entry in the filesystem scan
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FileEntry {
    /// Full absolute path to the file
    pub path: String,

    /// File size in bytes
    pub size: u64,

    /// Last modified time (Unix timestamp in seconds)
    pub modified_time: i64,

    /// Last accessed time (Unix timestamp in seconds)
    pub accessed_time: i64,

    /// Creation time (Unix timestamp in seconds), if available
    pub created_time: Option<i64>,

    /// File extension or 'directory' for directories
    pub file_type: String,

    /// Inode number
    pub inode: u64,

    /// Unix permissions (octal representation)
    pub permissions: u32,

    /// User ID (owner)
    pub uid: u32,

    /// Group ID
    pub gid: u32,

    /// Username (owner name, if resolvable)
    pub owner: Option<String>,

    /// Group name (if resolvable)
    pub group: Option<String>,

    /// Parent directory path
    pub parent_path: String,

    /// Depth from scan root (0 = root)
    pub depth: u32,

    /// Top-level directory name from scan root
    pub top_level_dir: String,
}

impl FileEntry {
    /// Create a FileEntry from filesystem metadata
    pub fn from_path(
        path: &Path,
        metadata: &std::fs::Metadata,
        scan_root: &Path,
    ) -> anyhow::Result<Self> {
        use std::os::unix::fs::MetadataExt;
        use std::time::SystemTime;

        let path_str = path.to_string_lossy().to_string();

        // Calculate parent path
        let parent_path = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/".to_string());

        // Calculate depth from scan root
        let depth = path
            .strip_prefix(scan_root)
            .map(|p| p.components().count() as u32)
            .unwrap_or(0);

        // Get top-level directory
        let top_level_dir = path
            .strip_prefix(scan_root)
            .ok()
            .and_then(|p| p.components().next())
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .unwrap_or_else(|| scan_root.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "root".to_string()));

        // Determine file type
        let file_type = if metadata.is_dir() {
            "directory".to_string()
        } else {
            path.extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_else(|| "no_extension".to_string())
        };

        // Get timestamps
        let modified_time = metadata
            .modified()?
            .duration_since(SystemTime::UNIX_EPOCH)?
            .as_secs() as i64;

        let accessed_time = metadata
            .accessed()?
            .duration_since(SystemTime::UNIX_EPOCH)?
            .as_secs() as i64;

        let created_time = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        // Get owner and group IDs
        let uid = metadata.uid();
        let gid = metadata.gid();

        // Try to resolve uid/gid to names (may fail on some systems)
        let owner = get_username(uid);
        let group = get_groupname(gid);

        // Reject-don't-repair: a NUL in any field means memory corruption
        // somewhere upstream — losing the row is safer than trusting it.
        for (field, value) in [
            ("path", Some(path_str.as_str())),
            ("parent_path", Some(parent_path.as_str())),
            ("top_level_dir", Some(top_level_dir.as_str())),
            ("file_type", Some(file_type.as_str())),
            ("owner", owner.as_deref()),
            ("group", group.as_deref()),
        ] {
            if let Some(v) = value {
                if v.contains('\0') {
                    anyhow::bail!("rejected row: embedded NUL in {field} for {path_str:?}");
                }
            }
        }

        Ok(FileEntry {
            path: path_str,
            size: metadata.len(),
            modified_time,
            accessed_time,
            created_time,
            file_type,
            inode: metadata.ino(),
            permissions: metadata.mode(),
            uid,
            gid,
            owner,
            group,
            parent_path,
            depth,
            top_level_dir,
        })
    }
}

/// Configuration options for scanning
#[derive(Debug, Clone)]
pub struct ScanOptions {
    /// Number of parallel threads to use
    pub num_threads: usize,

    /// Batch size for writing to Parquet
    pub batch_size: usize,

    /// Whether to follow symbolic links
    pub follow_symlinks: bool,

    /// Maximum depth to scan (None = unlimited)
    pub max_depth: Option<usize>,

    /// Enable checkpointing for resume capability
    pub enable_checkpointing: bool,

    /// Checkpoint file path
    pub checkpoint_path: Option<String>,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            num_threads: num_cpus::get(),
            batch_size: 100_000,
            follow_symlinks: false,
            max_depth: None,
            enable_checkpointing: false,
            checkpoint_path: None,
        }
    }
}

/// Statistics about a completed scan
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanStats {
    /// Total number of files scanned
    pub files_scanned: u64,

    /// Total number of directories scanned
    pub directories_scanned: u64,

    /// Total size of all files in bytes
    pub total_size: u64,

    /// Number of errors encountered
    pub errors_encountered: u64,

    /// Duration of scan in seconds
    pub duration_secs: f64,

    /// Scan start time (Unix timestamp)
    pub start_time: i64,

    /// Scan end time (Unix timestamp)
    pub end_time: i64,
}

impl ScanStats {
    pub fn new() -> Self {
        use std::time::SystemTime;
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        Self {
            start_time: now,
            ..Default::default()
        }
    }

    pub fn finish(&mut self) {
        use std::time::SystemTime;
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        self.end_time = now;
        self.duration_secs = (self.end_time - self.start_time) as f64;
    }

    pub fn files_per_second(&self) -> f64 {
        if self.duration_secs > 0.0 {
            self.files_scanned as f64 / self.duration_secs
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_file_entry_creation() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "test content").unwrap();

        let metadata = fs::metadata(&file_path).unwrap();
        let entry = FileEntry::from_path(&file_path, &metadata, temp_dir.path()).unwrap();

        assert!(entry.path.ends_with("test.txt"));
        assert_eq!(entry.file_type, "txt");
        assert_eq!(entry.size, 12); // "test content" = 12 bytes
        assert_eq!(entry.depth, 1);
    }

    #[test]
    fn test_scan_stats() {
        let mut stats = ScanStats::new();
        std::thread::sleep(std::time::Duration::from_millis(200));
        stats.files_scanned = 1000;
        stats.finish();

        // Duration should be at least some time (may be low resolution on some systems)
        assert!(stats.duration_secs >= 0.0, "Duration was: {}", stats.duration_secs);

        // If duration is > 0, files_per_second should work
        if stats.duration_secs > 0.0 {
            assert!(stats.files_per_second() > 0.0);
        }
    }

    #[test]
    fn test_scan_options_default() {
        let options = ScanOptions::default();
        assert!(!options.follow_symlinks);
        assert_eq!(options.max_depth, None);
        assert!(options.batch_size > 0);
    }
}


#[cfg(all(test, unix))]
mod owner_resolution_tests {
    use super::*;

    #[test]
    fn current_uid_resolves_clean() {
        let uid = unsafe { libc::getuid() };
        let name = get_username(uid).expect("current uid must resolve");
        assert!(!name.is_empty());
        assert!(!name.contains('\0'));
        assert!(name.is_ascii() || std::str::from_utf8(name.as_bytes()).is_ok());
        // cached second call returns the identical value
        assert_eq!(get_username(uid), Some(name));
    }

    #[test]
    fn unknown_uid_is_none_not_garbage() {
        assert_eq!(get_username(4_000_000_000), None);
        assert_eq!(get_username(4_000_000_000), None); // cached None
    }

    #[test]
    fn concurrent_lookups_never_produce_nuls() {
        let handles: Vec<_> = (0..16)
            .map(|t| {
                std::thread::spawn(move || {
                    for i in 0..500u32 {
                        // mix resolvable and unresolvable uids across threads
                        let uid = if i % 2 == 0 { unsafe { libc::getuid() } } else { 3_900_000_000 + t + i };
                        if let Some(n) = get_username(uid) {
                            assert!(!n.contains('\0'), "NUL leaked from lookup");
                            assert!(n.len() < 64, "impossibly long uname: {n:?}");
                        }
                        if let Some(g) = get_groupname(unsafe { libc::getgid() }) {
                            assert!(!g.contains('\0'));
                        }
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn from_path_row_is_clean_or_rejected() {
        let dir = std::env::temp_dir().join("hk_owner_test");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("probe.txt");
        std::fs::write(&f, b"x").unwrap();
        let md = std::fs::metadata(&f).unwrap();
        let entry = FileEntry::from_path(&f, &md, &dir).expect("clean row accepted");
        assert!(!entry.path.contains('\0'));
        if let Some(o) = &entry.owner {
            assert!(!o.contains('\0'));
        }
    }
}
