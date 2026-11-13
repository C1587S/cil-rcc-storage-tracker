use clap::Parser;
use dupverify::run::{self, RunConfig};
use dupverify::verify::Settings;
use std::path::PathBuf;

/// Read-only content verification of duplicate candidates.
///
/// Reads candidate groups (JSON Lines, one group of same-size files per line),
/// confirms identical content with spread samples, then full BLAKE3 and
/// optionally a byte-for-byte comparison. Never modifies, moves or deletes
/// files and never emits deletion actions.
#[derive(Parser, Debug)]
#[command(name = "cil-dupverify", version)]
struct Cli {
    /// Candidate groups (JSONL) produced by scripts/dupverify/export_candidates.py
    #[arg(long)]
    input: PathBuf,
    /// Output directory (results.jsonl, hash-cache.jsonl, summary-*.json); created 0700
    #[arg(long)]
    out: Option<PathBuf>,
    /// Hash cache to reuse across runs (default: <out>/hash-cache.jsonl)
    #[arg(long)]
    cache: Option<PathBuf>,
    /// Concurrent files being read
    #[arg(long, default_value_t = 2)]
    workers: usize,
    /// Sustained read rate cap across all workers, MiB/s (0 = unlimited)
    #[arg(long, default_value_t = 100.0)]
    max_read_mib_s: f64,
    /// Total bytes this run may read, GiB (0 = unlimited). The run stops cleanly when reached.
    #[arg(long, default_value_t = 50.0)]
    budget_gib: f64,
    /// Size of each content sample, KiB
    #[arg(long, default_value_t = 64)]
    sample_kib: u64,
    /// Samples per file, spread from first to last byte
    #[arg(long, default_value_t = 5)]
    samples: u64,
    /// Read block for full hashing and comparison, KiB
    #[arg(long, default_value_t = 1024)]
    read_block_kib: u64,
    /// Also compare every verified copy byte for byte with the first one
    #[arg(long)]
    byte_verify: bool,
    /// Groups with more files are deferred (reported, not read)
    #[arg(long, default_value_t = 50_000)]
    max_group_files: usize,
    /// Only verify files under this directory (repeatable)
    #[arg(long)]
    prefix: Vec<String>,
    /// Ignore previous results in <out> and start over
    #[arg(long)]
    no_resume: bool,
    /// Print a read-only estimate of the work in --input and exit (no file access)
    #[arg(long)]
    plan: bool,
    /// Suppress periodic progress lines on stderr
    #[arg(long)]
    quiet: bool,
}

fn main() {
    let cli = Cli::parse();
    if cli.samples == 0 || cli.sample_kib == 0 || cli.read_block_kib == 0 || cli.workers == 0 {
        eprintln!("--samples, --sample-kib, --read-block-kib and --workers must be positive");
        std::process::exit(2);
    }
    let settings = Settings {
        sample_block: cli.sample_kib * 1024,
        samples: cli.samples,
        read_block: cli.read_block_kib * 1024,
        byte_verify: cli.byte_verify,
        max_group_files: cli.max_group_files,
        prefixes: cli.prefix.clone(),
    };
    if cli.plan {
        match run::plan(&cli.input, &settings) {
            Ok(p) => println!("{}", serde_json::to_string_pretty(&p).unwrap()),
            Err(e) => { eprintln!("cannot read input: {e}"); std::process::exit(1); }
        }
        return;
    }
    let Some(out) = cli.out.clone() else {
        eprintln!("--out is required (except with --plan)");
        std::process::exit(2);
    };
    run::install_signal_handlers();
    let cfg = RunConfig {
        input: cli.input,
        out_dir: out,
        cache_path: cli.cache,
        workers: cli.workers,
        max_read_bytes_s: (cli.max_read_mib_s > 0.0).then(|| cli.max_read_mib_s * 1024.0 * 1024.0),
        budget_bytes: (cli.budget_gib > 0.0).then(|| (cli.budget_gib * (1u64 << 30) as f64) as u64),
        settings,
        resume: !cli.no_resume,
        progress: !cli.quiet,
        stop_flag: None,
    };
    match run::run(&cfg, None) {
        Ok(s) => {
            println!("{}", serde_json::to_string_pretty(&s).unwrap());
            // 3 = stopped early (budget/interrupt): rerun with the same --out to resume.
            if s.stopped.is_some() {
                std::process::exit(3);
            }
        }
        Err(e) => {
            eprintln!("dupverify failed: {e}");
            std::process::exit(1);
        }
    }
}
