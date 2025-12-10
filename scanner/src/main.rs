use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use crossbeam_channel::bounded;
use std::path::PathBuf;
use storage_scanner::{models::ScanOptions, scanner::Scanner, utils, writer::write_to_parquet};
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
        } => {
            run_scan(path, output, threads, batch_size, follow_symlinks, max_depth)?;
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

    // Create channels for communication
    let (tx, rx) = bounded(batch_size * 2);

    // Create scanner
    let scanner = Scanner::new(options);

    // Spawn writer thread
    let output_clone = output.clone();
    let writer_handle = std::thread::spawn(move || {
        write_to_parquet(&output_clone, rx)
    });

    // Run scanner
    let stats = scanner.scan(&path, tx)
        .context("Scan failed")?;

    // Wait for writer to finish
    let rows_written = writer_handle
        .join()
        .map_err(|_| anyhow::anyhow!("Writer thread panicked"))?
        .context("Failed to write Parquet file")?;

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
    println!("Output written to: {}", output.display());

    Ok(())
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
