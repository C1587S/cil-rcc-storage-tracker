use crate::models::{FileEntry, ScanOptions, ScanStats};
use anyhow::{Context, Result};
use crossbeam_channel::{bounded, Sender};
use indicatif::{ProgressBar, ProgressStyle};
use jwalk::WalkDir;
use rayon::prelude::*;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{debug, error, info, warn};

/// Main scanner that traverses filesystem and collects file entries
pub struct Scanner {
    options: ScanOptions,
    stats: Arc<ScanStats>,
}

impl Scanner {
    pub fn new(options: ScanOptions) -> Self {
        Self {
            options,
            stats: Arc::new(ScanStats::new()),
        }
    }

    /// Scan a directory and send FileEntry records through the channel
    pub fn scan<P: AsRef<Path>>(
        &self,
        root_path: P,
        tx: Sender<Vec<FileEntry>>,
    ) -> Result<ScanStats> {
        self.scan_with_filter(root_path, tx, None)
    }

    /// Scan a directory with optional filter for skipping completed directories
    pub fn scan_with_filter<P: AsRef<Path>>(
        &self,
        root_path: P,
        tx: Sender<Vec<FileEntry>>,
        skip_dirs: Option<HashSet<String>>,
    ) -> Result<ScanStats> {
        let root_path = root_path.as_ref().canonicalize()
            .context("Failed to canonicalize root path")?;

        info!("Starting scan of: {}", root_path.display());
        info!("Scan configuration: threads={}, batch_size={}",
              self.options.num_threads, self.options.batch_size);

        if let Some(ref dirs) = skip_dirs {
            if !dirs.is_empty() {
                info!("Skipping {} already-completed directories:", dirs.len());
                for dir in dirs.iter().take(10) {
                    info!("  - {}", dir);
                }
                if dirs.len() > 10 {
                    info!("  ... and {} more", dirs.len() - 10);
                }
            }
        }

        // Setup progress bar
        let progress = ProgressBar::new_spinner();
        progress.set_style(
            ProgressStyle::default_spinner()
                .template("{spinner:.green} [{elapsed_precise}] {msg}")
                .unwrap()
        );

        // Atomic counters for statistics
        let files_counter = Arc::new(AtomicU64::new(0));
        let dirs_counter = Arc::new(AtomicU64::new(0));
        let size_counter = Arc::new(AtomicU64::new(0));
        let errors_counter = Arc::new(AtomicU64::new(0));
        let skipped_counter = Arc::new(AtomicU64::new(0));

        // Configure rayon thread pool
        rayon::ThreadPoolBuilder::new()
            .num_threads(self.options.num_threads)
            .build()
            .context("Failed to build thread pool")?
            .install(|| {
                self.scan_parallel(
                    &root_path,
                    tx,
                    &progress,
                    files_counter.clone(),
                    dirs_counter.clone(),
                    size_counter.clone(),
                    errors_counter.clone(),
                    skipped_counter.clone(),
                    skip_dirs,
                )
            })?;

        progress.finish_with_message("Scan complete");

        // Build final statistics
        let mut final_stats = ScanStats::new();
        final_stats.files_scanned = files_counter.load(Ordering::Relaxed);
        final_stats.directories_scanned = dirs_counter.load(Ordering::Relaxed);
        final_stats.total_size = size_counter.load(Ordering::Relaxed);
        final_stats.errors_encountered = errors_counter.load(Ordering::Relaxed);
        final_stats.finish();

        let skipped = skipped_counter.load(Ordering::Relaxed);

        info!("Scan completed: {} files, {} directories, {:.2} GB total",
              final_stats.files_scanned,
              final_stats.directories_scanned,
              final_stats.total_size as f64 / 1_073_741_824.0);

        if skipped > 0 {
            info!("Skipped {} files from already-completed directories", skipped);
        }

        info!("Performance: {:.2} files/second, duration: {:.2}s",
              final_stats.files_per_second(),
              final_stats.duration_secs);

        if final_stats.errors_encountered > 0 {
            warn!("Encountered {} errors during scan", final_stats.errors_encountered);
        }

        Ok(final_stats)
    }

    fn scan_parallel(
        &self,
        root_path: &Path,
        tx: Sender<Vec<FileEntry>>,
        progress: &ProgressBar,
        files_counter: Arc<AtomicU64>,
        dirs_counter: Arc<AtomicU64>,
        size_counter: Arc<AtomicU64>,
        errors_counter: Arc<AtomicU64>,
        skipped_counter: Arc<AtomicU64>,
        skip_dirs: Option<HashSet<String>>,
    ) -> Result<()> {
        let batch_size = self.options.batch_size;
        let follow_symlinks = self.options.follow_symlinks;
        let max_depth = self.options.max_depth;

        // Configure jwalk
        let mut walker = WalkDir::new(root_path)
            .follow_links(follow_symlinks)
            .parallelism(jwalk::Parallelism::RayonNewPool(self.options.num_threads));

        if let Some(depth) = max_depth {
            walker = walker.max_depth(depth);
        }

        // Collect entries in batches
        let (batch_tx, batch_rx) = bounded::<FileEntry>(batch_size * 2);

        // Spawn thread to collect and send batches
        let tx_clone = tx.clone();
        let batch_thread = std::thread::spawn(move || {
            let mut batch = Vec::with_capacity(batch_size);

            for entry in batch_rx {
                batch.push(entry);

                if batch.len() >= batch_size {
                    let send_batch = std::mem::replace(&mut batch, Vec::with_capacity(batch_size));
                    if tx_clone.send(send_batch).is_err() {
                        break;
                    }
                }
            }

            // Send remaining entries
            if !batch.is_empty() {
                let _ = tx_clone.send(batch);
            }
        });

        // Process directory entries in parallel
        walker.into_iter()
            .par_bridge()
            .for_each(|entry_result| {
                match entry_result {
                    Ok(entry) => {
                        let path = entry.path();

                        match std::fs::metadata(&path) {
                            Ok(metadata) => {
                                // Create FileEntry first to check top_level_dir
                                match FileEntry::from_path(&path, &metadata, root_path) {
                                    Ok(file_entry) => {
                                        // Skip if this top-level directory is already completed
                                        if let Some(ref skip_set) = skip_dirs {
                                            if skip_set.contains(&file_entry.top_level_dir) {
                                                skipped_counter.fetch_add(1, Ordering::Relaxed);
                                                return; // Skip this entry
                                            }
                                        }

                                        // Update counters
                                        if metadata.is_dir() {
                                            dirs_counter.fetch_add(1, Ordering::Relaxed);
                                        } else {
                                            files_counter.fetch_add(1, Ordering::Relaxed);
                                            size_counter.fetch_add(metadata.len(), Ordering::Relaxed);
                                        }

                                        // Update progress
                                        let total = files_counter.load(Ordering::Relaxed)
                                                  + dirs_counter.load(Ordering::Relaxed);
                                        if total % 10000 == 0 {
                                            let skipped = skipped_counter.load(Ordering::Relaxed);
                                            let msg = if skipped > 0 {
                                                format!(
                                                    "Scanned: {} files, {} dirs, {:.2} GB (skipped: {})",
                                                    files_counter.load(Ordering::Relaxed),
                                                    dirs_counter.load(Ordering::Relaxed),
                                                    size_counter.load(Ordering::Relaxed) as f64 / 1_073_741_824.0,
                                                    skipped
                                                )
                                            } else {
                                                format!(
                                                    "Scanned: {} files, {} dirs, {:.2} GB",
                                                    files_counter.load(Ordering::Relaxed),
                                                    dirs_counter.load(Ordering::Relaxed),
                                                    size_counter.load(Ordering::Relaxed) as f64 / 1_073_741_824.0
                                                )
                                            };
                                            progress.set_message(msg);
                                        }

                                        // Send the entry
                                        if batch_tx.send(file_entry).is_err() {
                                            debug!("Batch channel closed, stopping scan");
                                        }
                                    }
                                    Err(e) => {
                                        errors_counter.fetch_add(1, Ordering::Relaxed);
                                        error!("Failed to create entry for {}: {}", path.display(), e);
                                    }
                                }
                            }
                            Err(e) => {
                                errors_counter.fetch_add(1, Ordering::Relaxed);
                                debug!("Failed to get metadata for {}: {}", path.display(), e);
                            }
                        }
                    }
                    Err(e) => {
                        errors_counter.fetch_add(1, Ordering::Relaxed);
                        debug!("Failed to read directory entry: {}", e);
                    }
                }
            });

        // Close batch channel and wait for batch thread
        drop(batch_tx);
        batch_thread.join().map_err(|_| anyhow::anyhow!("Batch thread panicked"))?;

        Ok(())
    }
}

/// Simple scan function for testing and basic use cases
pub fn scan_directory<P: AsRef<Path>>(
    root_path: P,
    options: ScanOptions,
) -> Result<Vec<FileEntry>> {
    let (tx, rx) = bounded(options.batch_size);
    let scanner = Scanner::new(options);

    let root_path_clone = root_path.as_ref().to_path_buf();

    // Spawn scanner in separate thread
    let scan_handle = std::thread::spawn(move || {
        scanner.scan(root_path_clone, tx)
    });

    // Collect results
    let mut entries = Vec::new();
    for batch in rx {
        entries.extend(batch);
    }

    // Wait for scanner to complete
    scan_handle.join()
        .map_err(|_| anyhow::anyhow!("Scanner thread panicked"))??;

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_structure() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Create some files and directories
        fs::create_dir_all(base.join("dir1/subdir1")).unwrap();
        fs::create_dir_all(base.join("dir2")).unwrap();

        fs::write(base.join("file1.txt"), "content1").unwrap();
        fs::write(base.join("dir1/file2.txt"), "content2").unwrap();
        fs::write(base.join("dir1/subdir1/file3.txt"), "content3").unwrap();
        fs::write(base.join("dir2/file4.log"), "content4").unwrap();

        temp_dir
    }

    #[test]
    fn test_scan_directory_basic() {
        let temp_dir = create_test_structure();
        let options = ScanOptions {
            num_threads: 2,
            batch_size: 10,
            ..Default::default()
        };

        let entries = scan_directory(temp_dir.path(), options).unwrap();

        // Should have 4 files + 3 subdirectories (+ root might be included)
        assert!(entries.len() >= 7 && entries.len() <= 8, "Expected 7 or 8 entries, got {}", entries.len());

        // Check that we have the right file types
        let txt_files: Vec<_> = entries.iter()
            .filter(|e| e.file_type == "txt")
            .collect();
        assert_eq!(txt_files.len(), 3);

        let log_files: Vec<_> = entries.iter()
            .filter(|e| e.file_type == "log")
            .collect();
        assert_eq!(log_files.len(), 1);

        let dirs: Vec<_> = entries.iter()
            .filter(|e| e.file_type == "directory")
            .collect();
        assert!(dirs.len() >= 3, "Expected at least 3 directories, got {}", dirs.len());
    }

    #[test]
    fn test_scan_with_max_depth() {
        let temp_dir = create_test_structure();
        let options = ScanOptions {
            num_threads: 2,
            batch_size: 10,
            max_depth: Some(1),
            ..Default::default()
        };

        let entries = scan_directory(temp_dir.path(), options).unwrap();

        // With depth 1, we should only see: root files + immediate subdirs
        // Should not include dir1/subdir1/file3.txt
        let deep_file_exists = entries.iter()
            .any(|e| e.path.contains("subdir1"));
        assert!(!deep_file_exists);
    }

    #[test]
    fn test_scan_empty_directory() {
        let temp_dir = TempDir::new().unwrap();
        let options = ScanOptions::default();

        let entries = scan_directory(temp_dir.path(), options).unwrap();

        // Empty directory should still have root directory entry
        assert!(entries.is_empty() || entries.len() == 1);
    }
}
