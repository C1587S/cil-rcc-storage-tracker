use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::fs;
use storage_scanner::{models::ScanOptions, scanner::scan_directory};
use tempfile::TempDir;

/// Create a test directory structure with many small files
fn create_small_files_structure(num_files: usize) -> TempDir {
    let temp_dir = TempDir::new().unwrap();
    let base = temp_dir.path();

    for i in 0..num_files {
        let file_path = base.join(format!("file_{:06}.txt", i));
        fs::write(file_path, format!("Content {}", i)).unwrap();
    }

    temp_dir
}

/// Create a test directory structure with nested directories
fn create_nested_structure(depth: usize, files_per_level: usize) -> TempDir {
    let temp_dir = TempDir::new().unwrap();
    let base = temp_dir.path();

    fn create_level(path: &std::path::Path, current_depth: usize, max_depth: usize, files: usize) {
        if current_depth >= max_depth {
            return;
        }

        // Create files at this level
        for i in 0..files {
            fs::write(path.join(format!("file_{}.txt", i)), "content").unwrap();
        }

        // Create subdirectories
        for i in 0..3 {
            let subdir = path.join(format!("dir_{}", i));
            fs::create_dir(&subdir).unwrap();
            create_level(&subdir, current_depth + 1, max_depth, files);
        }
    }

    create_level(base, 0, depth, files_per_level);
    temp_dir
}

/// Create a structure with large files
fn create_large_files_structure(num_files: usize, file_size_mb: usize) -> TempDir {
    let temp_dir = TempDir::new().unwrap();
    let base = temp_dir.path();

    let content = vec![0u8; file_size_mb * 1024 * 1024];

    for i in 0..num_files {
        let file_path = base.join(format!("large_file_{:02}.bin", i));
        fs::write(file_path, &content).unwrap();
    }

    temp_dir
}

fn benchmark_scan_small_files(c: &mut Criterion) {
    let mut group = c.benchmark_group("scan_small_files");

    for num_files in [100, 500, 1000].iter() {
        group.throughput(Throughput::Elements(*num_files as u64));

        group.bench_with_input(
            BenchmarkId::from_parameter(num_files),
            num_files,
            |b, &num_files| {
                let temp_dir = create_small_files_structure(num_files);
                let options = ScanOptions {
                    num_threads: 4,
                    batch_size: 1000,
                    ..Default::default()
                };

                b.iter(|| {
                    let entries = scan_directory(black_box(temp_dir.path()), options.clone()).unwrap();
                    black_box(entries)
                });
            },
        );
    }

    group.finish();
}

fn benchmark_scan_nested_directories(c: &mut Criterion) {
    let mut group = c.benchmark_group("scan_nested");

    for depth in [3, 5, 7].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(depth),
            depth,
            |b, &depth| {
                let temp_dir = create_nested_structure(depth, 5);
                let options = ScanOptions {
                    num_threads: 4,
                    batch_size: 1000,
                    ..Default::default()
                };

                b.iter(|| {
                    let entries = scan_directory(black_box(temp_dir.path()), options.clone()).unwrap();
                    black_box(entries)
                });
            },
        );
    }

    group.finish();
}

fn benchmark_parallel_vs_sequential(c: &mut Criterion) {
    let mut group = c.benchmark_group("parallel_comparison");
    let temp_dir = create_small_files_structure(500);

    for num_threads in [1, 2, 4, 8].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(num_threads),
            num_threads,
            |b, &threads| {
                let options = ScanOptions {
                    num_threads: threads,
                    batch_size: 1000,
                    ..Default::default()
                };

                b.iter(|| {
                    let entries = scan_directory(black_box(temp_dir.path()), options.clone()).unwrap();
                    black_box(entries)
                });
            },
        );
    }

    group.finish();
}

fn benchmark_batch_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_sizes");
    let temp_dir = create_small_files_structure(1000);

    for batch_size in [100, 1000, 10000].iter() {
        group.bench_with_input(
            BenchmarkId::from_parameter(batch_size),
            batch_size,
            |b, &batch_size| {
                let options = ScanOptions {
                    num_threads: 4,
                    batch_size,
                    ..Default::default()
                };

                b.iter(|| {
                    let entries = scan_directory(black_box(temp_dir.path()), options.clone()).unwrap();
                    black_box(entries)
                });
            },
        );
    }

    group.finish();
}

fn benchmark_max_depth(c: &mut Criterion) {
    let mut group = c.benchmark_group("max_depth");
    let temp_dir = create_nested_structure(7, 5);

    for max_depth in [Some(2), Some(4), None].iter() {
        let label = max_depth.map(|d| d.to_string()).unwrap_or_else(|| "unlimited".to_string());

        group.bench_with_input(
            BenchmarkId::from_parameter(&label),
            max_depth,
            |b, &max_depth| {
                let options = ScanOptions {
                    num_threads: 4,
                    batch_size: 1000,
                    max_depth,
                    ..Default::default()
                };

                b.iter(|| {
                    let entries = scan_directory(black_box(temp_dir.path()), options.clone()).unwrap();
                    black_box(entries)
                });
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    benchmark_scan_small_files,
    benchmark_scan_nested_directories,
    benchmark_parallel_vs_sequential,
    benchmark_batch_sizes,
    benchmark_max_depth
);

criterion_main!(benches);
