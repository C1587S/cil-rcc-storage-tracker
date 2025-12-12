# Storage Scanner

High-performance filesystem scanner written in Rust for storage analytics. Efficiently scans large filesystem hierarchies and outputs results in Apache Parquet format.

## Features

- High-performance parallel directory traversal
- Efficient Parquet output format with compression
- Incremental output mode for long-running scans
- Resume capability for interrupted scans
- Slurm integration for HPC cluster job arrays
- Comprehensive metadata capture (size, timestamps, permissions, hierarchy)
- Robust error handling for permission errors and broken symlinks

## Performance

- Throughput: Over 50,000 files/second on NVMe storage
- Memory: Less than 500MB RAM for scanning 1M+ files
- Scales efficiently to 400+ TB filesystems

## Installation

### Prerequisites

- Rust 1.70 or later
- Cargo (comes with Rust)

### Building

```bash
cd scanner
cargo build --release
```

The binary will be at `target/release/storage-scanner`

### Installing (Optional)

To install the scanner to your cargo bin directory and make it available system-wide:

```bash
cd scanner
cargo install --path .
```

This installs to `~/.cargo/bin/storage-scanner` (make sure `~/.cargo/bin` is in your PATH)

## Usage

### Basic Scan

```bash
./target/release/storage-scanner scan \
    --path /project/cil \
    --output scan_output.parquet \
    --threads 16
```

### Incremental Mode (Recommended for Long Scans)

For scans expected to take more than 1 hour, use incremental mode:

```bash
./target/release/storage-scanner scan \
    --path /large/directory \
    --output scan_output.parquet \
    --incremental \
    --rows-per-chunk 500000 \
    --chunk-interval-secs 300 \
    --resume \
    --threads 16
```

Incremental mode creates multiple complete Parquet files during the scan, allowing you to:
- Monitor progress and view partial results
- Resume if the scan is interrupted
- Analyze data while the scan continues

### Resume Interrupted Scans

If a scan is interrupted, simply run the same command again with `--resume`:

```bash
./target/release/storage-scanner scan \
    --path /large/directory \
    --output scan_output.parquet \
    --incremental \
    --resume \
    --threads 16
```

The scanner will skip already-completed directories and continue from where it left off.

### Aggregate Chunk Files

After an incremental scan completes, you can consolidate all chunk files into a single Parquet file:

```bash
./target/release/storage-scanner aggregate \
    --input /path/to/chunks/ \
    --output aggregated_scan.parquet \
    --delete-chunks
```

Options:
- `--input, -i`: Directory containing chunk files, or a specific chunk file pattern
- `--output, -o`: Output aggregated Parquet file
- `--delete-chunks, -d`: Delete chunk files after successful aggregation (optional)

This command:
- Combines all chunk files into a single Parquet file
- Maintains data integrity and schema consistency
- Optionally cleans up intermediate chunk files
- Shows progress and statistics

## Scan Command Options

- `--path, -p`: Path to scan (required)
- `--output, -o`: Output Parquet file path (required)
- `--threads, -t`: Number of threads (default: CPU cores)
- `--batch-size, -b`: Batch size for Parquet writes (default: 100,000)
- `--incremental`: Enable incremental output mode
- `--rows-per-chunk`: Rows per chunk in incremental mode (default: 500,000)
- `--chunk-interval-secs`: Time between chunks (default: 300)
- `--resume`: Resume an interrupted scan (requires --incremental)
- `--max-depth, -m`: Maximum depth to scan
- `--follow-symlinks, -f`: Follow symbolic links
- `--verbose, -v`: Enable verbose logging

## Slurm Integration (HPC Clusters)

For scanning large filesystems on HPC clusters, use Slurm job arrays to scan multiple directories in parallel.

### Example: Parallel Scan with Slurm

Create a Slurm script (`scan_parallel.sh`):

```bash
#!/bin/bash
#SBATCH --job-name=storage_scan
#SBATCH --account=your_account
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=16
#SBATCH --ntasks=1
#SBATCH --mem=64G
#SBATCH --time=24:00:00
#SBATCH --array=0-6
#SBATCH -o slurm_out/scan_%a.out
#SBATCH -e slurm_out/scan_%a.err

# Define directories to scan
DIRS=(
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
    "other_directory"
)

DIR=${DIRS[$SLURM_ARRAY_TASK_ID]}
BASE_PATH="/project/cil"
OUTPUT_DIR="/scratch/midway3/${USER}/scans"
DATE=$(date +%Y-%m-%d)

mkdir -p ${OUTPUT_DIR}

# Run scanner with resume capability
./scanner/target/release/storage-scanner scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads 16 \
    --incremental \
    --resume \
    --verbose
```

Submit the job:

```bash
mkdir -p slurm_out
sbatch scan_parallel.sh
```

Monitor progress:

```bash
# Check job status
squeue -u $USER

# Watch live output
tail -f slurm_out/scan_0.out

# Check for errors
grep -i error slurm_out/scan_*.err
```

Resume failed jobs:

```bash
# Resubmit specific array indices
sbatch --array=2,5 scan_parallel.sh
```

## Output Format

The scanner outputs Apache Parquet files with the following schema:

| Column | Type | Description |
|--------|------|-------------|
| path | String | Full absolute path |
| size | UInt64 | File size in bytes |
| modified_time | Int64 | Last modified time (Unix timestamp) |
| accessed_time | Int64 | Last accessed time (Unix timestamp) |
| created_time | Int64 | Creation time (Unix timestamp) |
| file_type | String | File extension or 'directory' |
| inode | UInt64 | Inode number |
| permissions | UInt32 | Unix permissions (octal) |
| parent_path | String | Parent directory path |
| depth | UInt32 | Depth from scan root |
| top_level_dir | String | Top-level directory name |

### Reading Output

#### Python (DuckDB)

```python
import duckdb

conn = duckdb.connect()
result = conn.execute("""
    SELECT * FROM 'scan_output.parquet'
    WHERE file_type = 'txt'
    LIMIT 10
""").fetchdf()

print(result)
```

#### Python (Polars)

```python
import polars as pl

# Single file
df = pl.read_parquet('scan_output.parquet')

# Multiple chunks from incremental mode
df = pl.read_parquet('scan_output_chunk_*.parquet')
```

#### Python (Pandas)

```python
import pandas as pd
import glob

# Single file
df = pd.read_parquet('scan_output.parquet')

# Multiple chunks
files = glob.glob('scan_output_chunk_*.parquet')
df = pd.concat([pd.read_parquet(f) for f in files])
```

## Development

### Running Tests

```bash
cargo test

# With output
cargo test -- --nocapture
```

### Running Benchmarks

```bash
cargo bench

# View HTML reports
open target/criterion/report/index.html
```

### Code Quality

```bash
# Lint
cargo clippy -- -D warnings

# Format
cargo fmt

# Check formatting
cargo fmt -- --check
```

## Troubleshooting

### Permission Errors

The scanner gracefully handles permission errors. To minimize them:

```bash
# Run with sudo if needed
sudo ./target/release/storage-scanner scan --path /protected --output scan.parquet
```

### Out of Memory

Reduce batch size for extremely large directories:

```bash
--batch-size 10000
```

### Slow Performance

Increase thread count:

```bash
--threads 32
```

Or limit depth for shallow scans:

```bash
--max-depth 5
```

## Scanner vs du Size Differences

The scanner reports actual file contents size, while `du` reports disk space used (including block overhead, metadata, etc.). For filesystems with many small files, `du` may report 2-3x more than the scanner. Both measurements are correct but represent different things:

- Scanner: Actual data in files (useful for transfer/backup estimates)
- du: Disk space consumed (useful for quota monitoring)

---

For more information, see the main project [README](../README.md).
