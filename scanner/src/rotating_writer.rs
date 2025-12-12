use crate::models::FileEntry;
use crate::writer::ParquetFileWriter;
use anyhow::{Context, Result};
use crossbeam_channel::Receiver;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tracing::{info, warn};

/// Configuration for rotating Parquet writer
#[derive(Debug, Clone)]
pub struct RotatingWriterConfig {
    /// Base output path (e.g., "scan_output.parquet")
    pub base_output_path: PathBuf,

    /// Maximum rows per chunk before rotation
    pub rows_per_chunk: usize,

    /// Time interval between rotations
    pub time_interval: Duration,
}

/// Metadata about a chunk file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMetadata {
    /// Chunk number (0-indexed)
    pub chunk_number: usize,

    /// File path
    pub file_path: String,

    /// Number of rows in this chunk
    pub row_count: u64,

    /// Size of chunk file in bytes
    pub file_size: u64,

    /// Timestamp when chunk was created
    pub created_at: i64,
}

/// Manifest file tracking all chunks
#[derive(Debug, Serialize, Deserialize)]
pub struct ScanManifest {
    /// Base scan path
    pub scan_path: String,

    /// Total rows across all chunks
    pub total_rows: u64,

    /// Number of chunks
    pub chunk_count: usize,

    /// List of chunk metadata
    pub chunks: Vec<ChunkMetadata>,

    /// Scan start timestamp
    pub scan_start: i64,

    /// Scan end timestamp (if complete)
    pub scan_end: Option<i64>,

    /// Scan completed successfully
    pub completed: bool,

    /// Top-level directories that have been fully scanned and written
    #[serde(default)]
    pub completed_top_level_dirs: HashSet<String>,

    /// Currently scanning top-level directory (may be incomplete)
    #[serde(default)]
    pub current_top_level_dir: Option<String>,
}

impl ScanManifest {
    pub fn new(scan_path: String) -> Self {
        use std::time::SystemTime;
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        Self {
            scan_path,
            total_rows: 0,
            chunk_count: 0,
            chunks: Vec::new(),
            scan_start: now,
            scan_end: None,
            completed: false,
            completed_top_level_dirs: HashSet::new(),
            current_top_level_dir: None,
        }
    }

    /// Load an existing manifest from a file
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let contents = std::fs::read_to_string(path.as_ref())
            .context("Failed to read manifest file")?;

        let manifest: Self = serde_json::from_str(&contents)
            .context("Failed to parse manifest JSON")?;

        Ok(manifest)
    }

    /// Check if a top-level directory has been completed
    pub fn is_dir_completed(&self, dir: &str) -> bool {
        self.completed_top_level_dirs.contains(dir)
    }

    /// Mark a top-level directory as in progress
    pub fn start_directory(&mut self, dir: String) {
        self.current_top_level_dir = Some(dir);
    }

    /// Mark the current directory as completed
    pub fn complete_current_directory(&mut self) {
        if let Some(dir) = self.current_top_level_dir.take() {
            self.completed_top_level_dirs.insert(dir);
        }
    }

    pub fn add_chunk(&mut self, metadata: ChunkMetadata) {
        self.total_rows += metadata.row_count;
        self.chunk_count += 1;
        self.chunks.push(metadata);
    }

    pub fn complete(&mut self) {
        use std::time::SystemTime;
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.scan_end = Some(now);
        self.completed = true;
    }

    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let json = serde_json::to_string_pretty(self)
            .context("Failed to serialize manifest")?;

        let mut file = File::create(path.as_ref())
            .context("Failed to create manifest file")?;

        file.write_all(json.as_bytes())
            .context("Failed to write manifest file")?;

        Ok(())
    }
}

/// Rotating Parquet writer that creates multiple readable files
pub struct RotatingParquetWriter {
    config: RotatingWriterConfig,
    current_writer: Option<ParquetFileWriter>,
    current_chunk: usize,
    current_chunk_rows: u64,
    last_rotation: Instant,
    pub manifest: ScanManifest,
    last_top_level_dir: Option<String>,
}

impl RotatingParquetWriter {
    pub fn new(config: RotatingWriterConfig, scan_path: String) -> Result<Self> {
        Ok(Self {
            config,
            current_writer: None,
            current_chunk: 0,
            current_chunk_rows: 0,
            last_rotation: Instant::now(),
            manifest: ScanManifest::new(scan_path),
            last_top_level_dir: None,
        })
    }

    /// Resume from an existing manifest
    pub fn resume(config: RotatingWriterConfig, scan_path: String) -> Result<Self> {
        let manifest_path = Self::get_manifest_path_static(&config.base_output_path);

        let manifest = if manifest_path.exists() {
            info!("Found existing manifest, resuming scan...");
            let mut m = ScanManifest::load_from_file(&manifest_path)?;

            // Reset completion flag since we're resuming
            m.completed = false;
            m.scan_end = None;

            info!("Resume state:");
            info!("  - Completed directories: {}", m.completed_top_level_dirs.len());
            info!("  - Existing chunks: {}", m.chunk_count);
            info!("  - Rows already scanned: {}", m.total_rows);

            m
        } else {
            info!("No existing manifest found, starting fresh scan");
            ScanManifest::new(scan_path)
        };

        let current_chunk = manifest.chunk_count;

        Ok(Self {
            config,
            current_writer: None,
            current_chunk,
            current_chunk_rows: 0,
            last_rotation: Instant::now(),
            manifest,
            last_top_level_dir: None,
        })
    }

    /// Get manifest path (static version for resume)
    fn get_manifest_path_static(base_output_path: &Path) -> PathBuf {
        let parent = base_output_path.parent().unwrap_or_else(|| Path::new("."));
        let stem = base_output_path.file_stem().unwrap().to_string_lossy();
        parent.join(format!("{}_manifest.json", stem))
    }

    /// Get the path for a specific chunk
    fn get_chunk_path(&self, chunk_number: usize) -> PathBuf {
        let base = &self.config.base_output_path;
        let parent = base.parent().unwrap_or_else(|| Path::new("."));
        let stem = base.file_stem().unwrap().to_string_lossy();
        let extension = base.extension().unwrap_or_default().to_string_lossy();

        parent.join(format!("{}_chunk_{:04}.{}", stem, chunk_number, extension))
    }

    /// Check if rotation is needed
    fn should_rotate(&self) -> bool {
        // Rotate if we've hit the row limit
        if self.current_chunk_rows >= self.config.rows_per_chunk as u64 {
            return true;
        }

        // Rotate if time interval has passed
        if self.last_rotation.elapsed() >= self.config.time_interval {
            return true;
        }

        false
    }

    /// Rotate to a new chunk file
    fn rotate(&mut self) -> Result<()> {
        // Close current writer if exists
        if let Some(writer) = self.current_writer.take() {
            let rows = writer.rows_written();
            writer.close()?;

            // Record chunk metadata
            let chunk_path = self.get_chunk_path(self.current_chunk);
            let file_size = std::fs::metadata(&chunk_path)
                .map(|m| m.len())
                .unwrap_or(0);

            use std::time::SystemTime;
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            let metadata = ChunkMetadata {
                chunk_number: self.current_chunk,
                file_path: chunk_path.to_string_lossy().to_string(),
                row_count: rows,
                file_size,
                created_at: now,
            };

            self.manifest.add_chunk(metadata);

            info!(
                "Completed chunk {}: {} rows, {:.2} MB",
                self.current_chunk,
                rows,
                file_size as f64 / 1_048_576.0
            );

            // Save manifest after each chunk
            let manifest_path = self.get_manifest_path();
            self.manifest.save_to_file(&manifest_path)
                .unwrap_or_else(|e| {
                    warn!("Failed to save manifest: {}", e);
                });
        }

        // Start new chunk
        self.current_chunk += 1;
        self.current_chunk_rows = 0;
        self.last_rotation = Instant::now();

        let chunk_path = self.get_chunk_path(self.current_chunk);
        info!("Starting new chunk: {}", chunk_path.display());

        let writer = ParquetFileWriter::new(&chunk_path)
            .context("Failed to create new chunk writer")?;

        self.current_writer = Some(writer);

        Ok(())
    }

    /// Get manifest file path
    fn get_manifest_path(&self) -> PathBuf {
        let base = &self.config.base_output_path;
        let parent = base.parent().unwrap_or_else(|| Path::new("."));
        let stem = base.file_stem().unwrap().to_string_lossy();

        parent.join(format!("{}_manifest.json", stem))
    }

    /// Write a batch of entries
    pub fn write_batch(&mut self, entries: &[FileEntry]) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }

        // Track directory transitions
        if let Some(first_entry) = entries.first() {
            let current_dir = first_entry.top_level_dir.clone();

            // If we've moved to a new top-level directory, mark the previous one as complete
            if let Some(ref last_dir) = self.last_top_level_dir {
                if last_dir != &current_dir {
                    info!("Completed scanning directory: {}", last_dir);
                    self.manifest.complete_current_directory();
                    self.manifest.start_directory(current_dir.clone());

                    // Save checkpoint after completing a directory
                    let manifest_path = self.get_manifest_path();
                    self.manifest.save_to_file(&manifest_path)
                        .unwrap_or_else(|e| {
                            warn!("Failed to save checkpoint: {}", e);
                        });
                }
            } else {
                // First directory
                self.manifest.start_directory(current_dir.clone());
            }

            self.last_top_level_dir = Some(current_dir);
        }

        // Initialize first writer if needed
        if self.current_writer.is_none() {
            self.rotate()?;
        }

        // Write batch to current writer first
        if let Some(writer) = &mut self.current_writer {
            writer.write_batch(entries)?;
            self.current_chunk_rows += entries.len() as u64;
        }

        // Check if we need to rotate after writing
        if self.should_rotate() {
            self.rotate()?;
        }

        Ok(())
    }

    /// Consume batches from a channel
    pub fn consume_batches(mut self, rx: Receiver<Vec<FileEntry>>) -> Result<ScanManifest> {
        let mut batches_processed = 0;

        for batch in rx {
            self.write_batch(&batch)?;
            batches_processed += 1;

            if batches_processed % 10 == 0 {
                info!(
                    "Processed {} batches, current chunk: {}, chunk rows: {}",
                    batches_processed,
                    self.current_chunk,
                    self.current_chunk_rows
                );
            }
        }

        // Close final writer and finalize manifest
        let manifest = self.finalize()?;

        Ok(manifest)
    }

    /// Finalize the scan and close all writers
    pub fn finalize(mut self) -> Result<ScanManifest> {
        // Close current writer
        if let Some(writer) = self.current_writer.take() {
            let rows = writer.rows_written();
            writer.close()?;

            // Record final chunk metadata
            let chunk_path = self.get_chunk_path(self.current_chunk);
            let file_size = std::fs::metadata(&chunk_path)
                .map(|m| m.len())
                .unwrap_or(0);

            use std::time::SystemTime;
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            let metadata = ChunkMetadata {
                chunk_number: self.current_chunk,
                file_path: chunk_path.to_string_lossy().to_string(),
                row_count: rows,
                file_size,
                created_at: now,
            };

            self.manifest.add_chunk(metadata);

            info!(
                "Completed final chunk {}: {} rows, {:.2} MB",
                self.current_chunk,
                rows,
                file_size as f64 / 1_048_576.0
            );
        }

        // Mark manifest as complete
        self.manifest.complete();

        // Save final manifest
        let manifest_path = self.get_manifest_path();
        self.manifest.save_to_file(&manifest_path)?;

        info!("Scan completed: {} total rows across {} chunks",
              self.manifest.total_rows,
              self.manifest.chunk_count);
        info!("Manifest saved to: {}", manifest_path.display());

        Ok(self.manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FileEntry;
    use crossbeam_channel::bounded;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_entry(path: &str, size: u64) -> FileEntry {
        FileEntry {
            path: path.to_string(),
            size,
            modified_time: 1700000000,
            accessed_time: 1700000000,
            created_time: Some(1700000000),
            file_type: "txt".to_string(),
            inode: 12345,
            permissions: 0o644,
            parent_path: "/parent".to_string(),
            depth: 1,
            top_level_dir: "root".to_string(),
        }
    }

    #[test]
    fn test_rotating_writer_basic() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("output.parquet");

        let config = RotatingWriterConfig {
            base_output_path: output_path,
            rows_per_chunk: 5, // Small chunk size for testing
            time_interval: Duration::from_secs(3600),
        };

        let (tx, rx) = bounded(10);

        // Send batches
        let handle = std::thread::spawn(move || {
            for i in 0..3 {
                let batch = vec![
                    create_test_entry(&format!("/test/file{}_1.txt", i), 1024),
                    create_test_entry(&format!("/test/file{}_2.txt", i), 2048),
                    create_test_entry(&format!("/test/file{}_3.txt", i), 3072),
                ];
                tx.send(batch).unwrap();
            }
        });

        let writer = RotatingParquetWriter::new(config, "/test".to_string()).unwrap();
        let manifest = writer.consume_batches(rx).unwrap();

        handle.join().unwrap();

        // Should have created 2 chunks (5 rows each, total 9 rows)
        assert_eq!(manifest.chunk_count, 2);
        assert_eq!(manifest.total_rows, 9);
        assert!(manifest.completed);

        // Verify chunk files exist
        for chunk in &manifest.chunks {
            let path = Path::new(&chunk.file_path);
            assert!(path.exists(), "Chunk file should exist: {:?}", path);
        }
    }

    #[test]
    fn test_manifest_serialization() {
        let mut manifest = ScanManifest::new("/test/path".to_string());

        manifest.add_chunk(ChunkMetadata {
            chunk_number: 0,
            file_path: "/tmp/chunk_0.parquet".to_string(),
            row_count: 1000,
            file_size: 50000,
            created_at: 1700000000,
        });

        manifest.complete();

        let temp_dir = TempDir::new().unwrap();
        let manifest_path = temp_dir.path().join("manifest.json");

        manifest.save_to_file(&manifest_path).unwrap();

        assert!(manifest_path.exists());

        // Verify content
        let content = fs::read_to_string(&manifest_path).unwrap();
        assert!(content.contains("test/path"));
        assert!(content.contains("chunk_0"));
    }
}
