use crossbeam_channel::bounded;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use std::fs::{self, File};
use storage_scanner::{
    models::{FileEntry, ScanOptions},
    scanner::{scan_directory, Scanner},
    writer::write_to_parquet,
};
use tempfile::TempDir;

/// Helper function to create a test directory structure
fn create_test_structure() -> TempDir {
    let temp_dir = TempDir::new().unwrap();
    let base = temp_dir.path();

    // Create directory structure
    fs::create_dir_all(base.join("dir1/subdir1")).unwrap();
    fs::create_dir_all(base.join("dir2")).unwrap();
    fs::create_dir_all(base.join("dir3/subdir2/deep")).unwrap();

    // Create files
    fs::write(base.join("file1.txt"), "content1").unwrap();
    fs::write(base.join("file2.log"), "content2").unwrap();
    fs::write(base.join("dir1/file3.txt"), "content3").unwrap();
    fs::write(base.join("dir1/subdir1/file4.txt"), "content4").unwrap();
    fs::write(base.join("dir2/file5.py"), "print('hello')").unwrap();
    fs::write(base.join("dir3/file6.json"), r#"{"key": "value"}"#).unwrap();
    fs::write(base.join("dir3/subdir2/file7.csv"), "a,b,c").unwrap();
    fs::write(base.join("dir3/subdir2/deep/file8.txt"), "deep content").unwrap();

    temp_dir
}

#[test]
fn test_end_to_end_scan_and_write() {
    let test_dir = create_test_structure();
    let output_dir = TempDir::new().unwrap();
    let output_file = output_dir.path().join("scan_output.parquet");

    let options = ScanOptions {
        num_threads: 2,
        batch_size: 10,
        ..Default::default()
    };

    let (tx, rx) = bounded::<Vec<FileEntry>>(20);
    let scanner = Scanner::new(options);

    let scan_path = test_dir.path().to_path_buf();

    // Run scanner in background thread
    let scan_handle = std::thread::spawn(move || scanner.scan(scan_path, tx));

    // Write to parquet
    let rows_written = write_to_parquet(&output_file, rx).unwrap();

    // Wait for scanner to complete
    let stats = scan_handle.join().unwrap().unwrap();

    // Verify output file exists
    assert!(output_file.exists());

    // Verify statistics
    assert_eq!(stats.files_scanned, 8);
    assert!(stats.directories_scanned >= 4); // At least 4 directories
    assert!(stats.total_size > 0);
    assert_eq!(rows_written, stats.files_scanned + stats.directories_scanned);

    // Read back parquet file and verify contents
    let file = File::open(&output_file).unwrap();
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
    let reader = builder.build().unwrap();

    let mut total_rows = 0;
    for batch_result in reader {
        let batch = batch_result.unwrap();
        total_rows += batch.num_rows();
    }

    assert_eq!(total_rows as u64, rows_written);
}

#[test]
fn test_scan_with_max_depth() {
    let test_dir = create_test_structure();

    let options = ScanOptions {
        num_threads: 2,
        batch_size: 10,
        max_depth: Some(2),
        ..Default::default()
    };

    let entries = scan_directory(test_dir.path(), options).unwrap();

    // With max_depth=2, should not include deeply nested files
    let deep_files: Vec<_> = entries
        .iter()
        .filter(|e| e.path.contains("deep"))
        .collect();

    assert_eq!(deep_files.len(), 0, "Should not scan beyond max depth");
}

#[test]
fn test_scan_file_types() {
    let test_dir = create_test_structure();

    let options = ScanOptions {
        num_threads: 2,
        batch_size: 10,
        ..Default::default()
    };

    let entries = scan_directory(test_dir.path(), options).unwrap();

    // Count file types
    let txt_files: Vec<_> = entries.iter().filter(|e| e.file_type == "txt").collect();
    let py_files: Vec<_> = entries.iter().filter(|e| e.file_type == "py").collect();
    let json_files: Vec<_> = entries.iter().filter(|e| e.file_type == "json").collect();
    let csv_files: Vec<_> = entries.iter().filter(|e| e.file_type == "csv").collect();
    let log_files: Vec<_> = entries.iter().filter(|e| e.file_type == "log").collect();
    let directories: Vec<_> = entries.iter().filter(|e| e.file_type == "directory").collect();

    assert_eq!(txt_files.len(), 5);
    assert_eq!(py_files.len(), 1);
    assert_eq!(json_files.len(), 1);
    assert_eq!(csv_files.len(), 1);
    assert_eq!(log_files.len(), 1);
    assert!(directories.len() >= 4);
}

#[test]
fn test_scan_depth_calculation() {
    let test_dir = create_test_structure();

    let options = ScanOptions::default();
    let entries = scan_directory(test_dir.path(), options).unwrap();

    // Find the deep file and verify its depth
    let deep_file = entries
        .iter()
        .find(|e| e.path.contains("deep/file8.txt"))
        .expect("Should find deep file");

    assert_eq!(deep_file.depth, 4); // dir3/subdir2/deep/file8.txt

    // Check root level files
    let root_files: Vec<_> = entries.iter().filter(|e| e.depth == 1).collect();
    assert!(root_files.len() >= 2);
}

#[test]
fn test_scan_parent_paths() {
    let test_dir = create_test_structure();

    let options = ScanOptions::default();
    let entries = scan_directory(test_dir.path(), options).unwrap();

    // Verify parent paths are correctly set
    for entry in entries.iter() {
        if entry.file_type != "directory" {
            // File's parent should exist in the entries as a directory
            let parent_exists = entries
                .iter()
                .any(|e| e.path == entry.parent_path && e.file_type == "directory");

            assert!(
                parent_exists || entry.parent_path == test_dir.path().to_string_lossy(),
                "Parent path should exist: {}",
                entry.parent_path
            );
        }
    }
}

#[test]
fn test_scan_empty_directory() {
    let temp_dir = TempDir::new().unwrap();

    let options = ScanOptions::default();
    let entries = scan_directory(temp_dir.path(), options).unwrap();

    // Empty directory should result in minimal or no entries
    assert!(entries.is_empty() || entries.len() == 1);
}

#[test]
fn test_multiple_batches() {
    let test_dir = create_test_structure();
    let output_dir = TempDir::new().unwrap();
    let output_file = output_dir.path().join("batched_output.parquet");

    // Use very small batch size to force multiple batches
    let options = ScanOptions {
        num_threads: 2,
        batch_size: 2,
        ..Default::default()
    };

    let (tx, rx) = bounded(4);
    let scanner = Scanner::new(options);

    let scan_path = test_dir.path().to_path_buf();

    let scan_handle = std::thread::spawn(move || scanner.scan(scan_path, tx));

    let rows_written = write_to_parquet(&output_file, rx).unwrap();
    let stats = scan_handle.join().unwrap().unwrap();

    assert!(output_file.exists());
    assert_eq!(rows_written, stats.files_scanned + stats.directories_scanned);
}

#[test]
fn test_scan_statistics() {
    let test_dir = create_test_structure();

    let options = ScanOptions {
        num_threads: 2,
        batch_size: 10,
        ..Default::default()
    };

    let (tx, rx) = bounded::<Vec<FileEntry>>(20);
    let scanner = Scanner::new(options);

    let scan_path = test_dir.path().to_path_buf();

    // Drain receiver in background
    let drain_handle = std::thread::spawn(move || {
        let mut count = 0;
        for batch in rx {
            count += batch.len();
        }
        count
    });

    let stats = scanner.scan(scan_path, tx).unwrap();

    let total_entries = drain_handle.join().unwrap();

    // Verify statistics
    assert_eq!(stats.files_scanned, 8);
    assert!(stats.directories_scanned > 0);
    assert_eq!(
        total_entries as u64,
        stats.files_scanned + stats.directories_scanned
    );
    assert!(stats.duration_secs > 0.0);
    assert!(stats.files_per_second() > 0.0);
}
