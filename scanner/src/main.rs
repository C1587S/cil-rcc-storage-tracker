use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use crossbeam_channel::bounded;
use std::path::PathBuf;
use std::time::Duration;
use storage_scanner::{
    models::ScanOptions,
    scanner::Scanner,
    utils,
    writer::write_to_parquet,
    rotating_writer::{RotatingParquetWriter, RotatingWriterConfig},
};
use tracing::{error, info};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[derive(Parser)]
#[command(name = "storage-scanner")]
#[command(author, version, about = "High-performance filesystem scanner for storage analytics", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Enable verbose logging
    #[arg(short, long, global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Scan a directory and output to Parquet file
    Scan {
        /// Path to scan
        #[arg(short, long)]
        path: PathBuf,

        /// Output Parquet file path
        #[arg(short, long)]
        output: PathBuf,

        /// Number of threads to use (default: number of CPU cores)
        #[arg(short, long)]
        threads: Option<usize>,

        /// Batch size for writing to Parquet
        #[arg(short, long, default_value = "100000")]
        batch_size: usize,

        /// Follow symbolic links
        #[arg(short, long)]
        follow_symlinks: bool,

        /// Maximum depth to scan (unlimited if not specified)
        #[arg(short, long)]
        max_depth: Option<usize>,

        /// Log file path (optional)
        #[arg(short, long)]
        log_file: Option<PathBuf>,

        /// Enable incremental output mode (creates multiple readable files during scan)
        #[arg(long)]
        incremental: bool,

        /// Rows per chunk when using incremental mode
        #[arg(long, default_value = "500000")]
        rows_per_chunk: usize,

        /// Time interval in seconds between chunks (used alongside rows_per_chunk)
        #[arg(long, default_value = "300")]
        chunk_interval_secs: u64,

        /// Resume an interrupted scan (only works with --incremental mode)
        #[arg(long)]
        resume: bool,
    },

    /// Aggregate multiple Parquet chunk files into a single file
    Aggregate {
        /// Input pattern or directory containing chunk files (e.g., scan_chunk_*.parquet or /path/to/chunks/)
        #[arg(short, long)]
        input: PathBuf,

        /// Output Parquet file path
        #[arg(short, long)]
        output: PathBuf,

        /// Delete chunk files after successful aggregation
        #[arg(short, long)]
        delete_chunks: bool,
    },

    /// Display version information
    Version,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Setup logging
    setup_logging(cli.verbose)?;

    match cli.command {
        Commands::Scan {
            path,
            output,
            threads,
            batch_size,
            follow_symlinks,
            max_depth,
            log_file: _,
            incremental,
            rows_per_chunk,
            chunk_interval_secs,
            resume,
        } => {
            run_scan(
                path,
                output,
                threads,
                batch_size,
                follow_symlinks,
                max_depth,
                incremental,
                rows_per_chunk,
                chunk_interval_secs,
                resume,
            )?;
        }
        Commands::Aggregate {
            input,
            output,
            delete_chunks,
        } => {
            run_aggregate(input, output, delete_chunks)?;
        }
        Commands::Version => {
            println!("storage-scanner v{}", env!("CARGO_PKG_VERSION"));
            println!("High-performance filesystem scanner for storage analytics");
        }
    }

    Ok(())
}

fn setup_logging(verbose: bool) -> Result<()> {
    let filter = if verbose {
        EnvFilter::new("debug")
    } else {
        EnvFilter::new("info")
    };

    tracing_subscriber::registry()
        .with(fmt::layer().with_target(false))
        .with(filter)
        .init();

    Ok(())
}

fn run_scan(
    path: PathBuf,
    output: PathBuf,
    threads: Option<usize>,
    batch_size: usize,
    follow_symlinks: bool,
    max_depth: Option<usize>,
    incremental: bool,
    rows_per_chunk: usize,
    chunk_interval_secs: u64,
    resume: bool,
) -> Result<()> {
    info!("Storage Scanner v{}", env!("CARGO_PKG_VERSION"));
    info!("Starting scan operation");

    // Validate input path
    utils::validate_path(&path)
        .context("Invalid input path")?;

    // Ensure output directory exists
    utils::ensure_output_dir(&output)
        .context("Failed to create output directory")?;

    // Configure scan options
    let options = ScanOptions {
        num_threads: threads.unwrap_or_else(num_cpus::get),
        batch_size,
        follow_symlinks,
        max_depth,
        enable_checkpointing: false,
        checkpoint_path: None,
    };

    info!("Scan configuration:");
    info!("  Input path: {}", path.display());
    info!("  Output file: {}", output.display());
    info!("  Threads: {}", options.num_threads);
    info!("  Batch size: {}", utils::format_number(options.batch_size as u64));
    info!("  Follow symlinks: {}", options.follow_symlinks);
    if let Some(depth) = options.max_depth {
        info!("  Max depth: {}", depth);
    }

    // Validate resume mode
    if resume && !incremental {
        error!("Resume mode requires --incremental flag");
        return Err(anyhow::anyhow!("--resume requires --incremental"));
    }

    if incremental {
        info!("  Incremental mode: ENABLED");
        info!("  Rows per chunk: {}", utils::format_number(rows_per_chunk as u64));
        info!("  Chunk interval: {} seconds", chunk_interval_secs);
        if resume {
            info!("  Resume mode: ENABLED");
        }
        info!("");
        info!("Note: Each chunk will be a complete, readable Parquet file.");
        info!("      You can read chunks while the scan is still running.");
    }

    // Create channels for communication
    let (tx, rx) = bounded(batch_size * 2);

    // Create scanner
    let scanner = Scanner::new(options);

    // Spawn writer thread based on mode
    let output_clone = output.clone();
    let path_str = path.to_string_lossy().to_string();

    // Run scanner and writer based on mode
    let (stats, rows_written) = if incremental {
        // Use rotating writer for incremental mode
        let config = RotatingWriterConfig {
            base_output_path: output_clone.clone(),
            rows_per_chunk,
            time_interval: Duration::from_secs(chunk_interval_secs),
        };

        // Create or resume writer
        let (writer, skip_dirs) = if resume {
            let writer = RotatingParquetWriter::resume(config, path_str.clone())?;
            let skip_dirs = Some(writer.manifest.completed_top_level_dirs.clone());
            (writer, skip_dirs)
        } else {
            let writer = RotatingParquetWriter::new(config, path_str.clone())?;
            (writer, None)
        };

        let writer_handle = std::thread::spawn(move || {
            let manifest = writer.consume_batches(rx)?;
            Ok::<u64, anyhow::Error>(manifest.total_rows)
        });

        // Run scanner with optional directory filter
        let stats = if let Some(skip_dirs) = skip_dirs {
            scanner.scan_with_filter(&path, tx, Some(skip_dirs))
                .context("Scan failed")?
        } else {
            scanner.scan(&path, tx)
                .context("Scan failed")?
        };

        // Wait for writer to finish
        let rows = writer_handle
            .join()
            .map_err(|_| anyhow::anyhow!("Writer thread panicked"))?
            .context("Failed to write Parquet files")?;

        (stats, rows)
    } else {
        // Use regular single-file writer
        let writer_handle = std::thread::spawn(move || {
            write_to_parquet(&output_clone, rx)
        });

        // Run scanner
        let stats = scanner.scan(&path, tx)
            .context("Scan failed")?;

        // Wait for writer to finish
        let rows = writer_handle
            .join()
            .map_err(|_| anyhow::anyhow!("Writer thread panicked"))?
            .context("Failed to write Parquet file")?;

        (stats, rows)
    };

    // Print final statistics
    println!();
    println!("Scan completed successfully");
    println!("---");
    println!("Files scanned:       {}", utils::format_number(stats.files_scanned));
    println!("Directories scanned: {}", utils::format_number(stats.directories_scanned));
    println!("Total size:          {}", utils::format_bytes(stats.total_size));
    println!("Rows written:        {}", utils::format_number(rows_written));
    println!("Duration:            {}", utils::format_duration(stats.duration_secs));
    println!("Performance:         {:.0} files/second", stats.files_per_second());

    if stats.errors_encountered > 0 {
        println!("Errors encountered:  {}", utils::format_number(stats.errors_encountered));
        println!("Note: Some files may have been skipped due to permission errors");
    }

    println!();
    if incremental {
        println!("Output written to chunk files:");
        println!("  Base name: {}", output.display());
        println!("  Pattern: {}_chunk_*.parquet", output.file_stem().unwrap().to_string_lossy());
        println!("  Manifest: {}_manifest.json", output.file_stem().unwrap().to_string_lossy());
        println!();
        println!("To read all chunks in Python:");
        println!("  import polars as pl");
        println!("  df = pl.read_parquet('{}_chunk_*.parquet')",
                 output.file_stem().unwrap().to_string_lossy());
    } else {
        println!("Output written to: {}", output.display());
    }

    Ok(())
}

fn run_aggregate(input: PathBuf, output: PathBuf, delete_chunks: bool) -> Result<()> {
    use arrow::datatypes::SchemaRef;
    use parquet::arrow::ArrowWriter;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use parquet::file::reader::{FileReader, SerializedFileReader};
    use std::fs;
    use std::sync::Arc;

    info!("Storage Scanner v{}", env!("CARGO_PKG_VERSION"));
    info!("Starting aggregation operation");

    // Find chunk files
    let chunk_files = find_chunk_files(&input)?;

    if chunk_files.is_empty() {
        error!("No Parquet chunk files found");
        return Err(anyhow::anyhow!("No chunk files found in: {}", input.display()));
    }

    info!("Found {} chunk file(s) to aggregate", chunk_files.len());
    info!("Output file: {}", output.display());

    // Ensure output directory exists
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .context("Failed to create output directory")?;
    }

    // Read schema from first file
    let first_file = fs::File::open(&chunk_files[0])?;
    let first_reader = SerializedFileReader::new(first_file)?;
    let schema = first_reader.metadata().file_metadata().schema_descr();

    // Convert to Arrow schema
    let arrow_schema: SchemaRef = Arc::new(
        parquet::arrow::parquet_to_arrow_schema(&schema, None)?
    );

    info!("Creating aggregated file...");

    // Create writer
    let output_file = fs::File::create(&output)
        .context("Failed to create output file")?;

    let mut writer = ArrowWriter::try_new(
        output_file,
        arrow_schema.clone(),
        None,
    )?;

    let mut total_rows = 0u64;
    let start_time = std::time::Instant::now();

    // Process each chunk file
    for (i, chunk_path) in chunk_files.iter().enumerate() {
        info!("  [{}/{}] Processing: {}", i + 1, chunk_files.len(), chunk_path.display());

        // Read chunk as Arrow batches
        let file = fs::File::open(chunk_path)?;
        let builder = ParquetRecordBatchReaderBuilder::try_new(file)?;
        let mut reader = builder.with_batch_size(100000).build()?;

        while let Some(batch_result) = reader.next() {
            let batch = batch_result?;
            total_rows += batch.num_rows() as u64;
            writer.write(&batch)?;
        }
    }

    // Finalize writer
    writer.close()?;

    let duration = start_time.elapsed();

    info!("Aggregation completed successfully");
    println!();
    println!("Aggregation Summary");
    println!("---");
    println!("Chunk files processed: {}", chunk_files.len());
    println!("Total rows:            {}", utils::format_number(total_rows));
    println!("Duration:              {:.2}s", duration.as_secs_f64());
    println!("Output file:           {}", output.display());
    println!("Output size:           {}", utils::format_bytes(fs::metadata(&output)?.len()));

    // Delete chunk files if requested
    if delete_chunks {
        info!("Deleting chunk files...");
        let mut deleted = 0;
        for chunk_path in &chunk_files {
            match fs::remove_file(chunk_path) {
                Ok(_) => {
                    deleted += 1;
                    info!("  Deleted: {}", chunk_path.display());
                }
                Err(e) => {
                    error!("  Failed to delete {}: {}", chunk_path.display(), e);
                }
            }
        }

        // Also try to delete manifest file if it exists
        let manifest_path = get_manifest_path(&input);
        if manifest_path.exists() {
            if let Err(e) = fs::remove_file(&manifest_path) {
                error!("Failed to delete manifest file: {}", e);
            } else {
                info!("  Deleted manifest: {}", manifest_path.display());
            }
        }

        println!();
        println!("Deleted {} chunk file(s)", deleted);
    }

    Ok(())
}

fn find_chunk_files(input: &PathBuf) -> Result<Vec<PathBuf>> {
    use std::fs;

    let mut chunk_files = Vec::new();

    if input.is_dir() {
        // Input is a directory, find all chunk files
        for entry in fs::read_dir(input)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() {
                if let Some(name) = path.file_name() {
                    let name_str = name.to_string_lossy();
                    // Match chunk files but exclude manifest
                    if name_str.ends_with(".parquet") &&
                       (name_str.contains("chunk") || name_str.contains("_")) &&
                       !name_str.contains("manifest") {
                        chunk_files.push(path);
                    }
                }
            }
        }
    } else if input.is_file() {
        // Input is a single file
        chunk_files.push(input.clone());
    } else {
        // Input path doesn't exist - try to find matching chunk files
        let parent = input.parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid input path"))?;

        let base_name = input.file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("Invalid base filename"))?;

        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() {
                if let Some(name) = path.file_name() {
                    let name_str = name.to_string_lossy();
                    // Match files that start with the base name and are chunks
                    if name_str.starts_with(base_name) &&
                       name_str.ends_with(".parquet") &&
                       name_str.contains("chunk") &&
                       !name_str.contains("manifest") {
                        chunk_files.push(path);
                    }
                }
            }
        }
    }

    // Sort files for consistent ordering
    chunk_files.sort();

    Ok(chunk_files)
}

fn get_manifest_path(input: &PathBuf) -> PathBuf {
    if input.is_dir() {
        // Look for any manifest file in the directory
        if let Ok(entries) = std::fs::read_dir(input) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name() {
                    if name.to_string_lossy().contains("manifest") {
                        return path;
                    }
                }
            }
        }
    }

    // Default: assume manifest is next to the input
    let stem = input.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("scan");
    input.with_file_name(format!("{}_manifest.json", stem))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_parsing() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
