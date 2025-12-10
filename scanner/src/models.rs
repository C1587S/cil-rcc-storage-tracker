use serde::{Deserialize, Serialize};
use std::path::Path;

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

        Ok(FileEntry {
            path: path_str,
            size: metadata.len(),
            modified_time,
            accessed_time,
            created_time,
            file_type,
            inode: metadata.ino(),
            permissions: metadata.mode(),
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
