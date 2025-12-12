# Storage Scanner - Phase 1

High-performance filesystem scanner written in Rust for storage analytics. Efficiently scans large filesystem hierarchies and outputs results in Apache Parquet format.

## Features

- **High Performance**: Parallel directory traversal with configurable thread count
- **Efficient Storage**: Output to compressed Parquet format
- **Scalable**: Designed to handle 400+ TB filesystems
- **Slurm Integration**: Built-in support for HPC cluster job arrays
- **Comprehensive Metadata**: Captures file size, timestamps, permissions, and hierarchy
- **Robust Error Handling**: Gracefully handles permission errors and broken symlinks

## Performance Targets

- Throughput: >50,000 files/second on NVMe storage
- Memory: <500MB RAM for scanning 1M+ files
- CPU: Efficient multi-core utilization (>80% on 16+ cores)

## Installation

### Prerequisites

- Rust 1.70 or later
- Cargo (comes with Rust)

### Building from Source

```bash
# Clone the repository
cd scanner

# Build in release mode (optimized)
cargo build --release

# The binary will be at: target/release/storage-scanner
```

### Install Globally (Optional)

```bash
cargo install --path .
```

## Usage

### Basic Scan

Scan a directory and output to Parquet file:

```bash
storage-scanner scan \
    --path /project/cil \
    --output /snapshots/2024-01-15/cil.parquet
```

### Advanced Options

```bash
storage-scanner scan \
    --path /project/cil \
    --output /snapshots/2024-01-15/cil.parquet \
    --threads 32 \
    --batch-size 100000 \
    --follow-symlinks \
    --max-depth 10 \
    --verbose
```

#### Options

- `--path, -p`: Path to scan (required)
- `--output, -o`: Output Parquet file path (required)
- `--threads, -t`: Number of threads to use (default: number of CPU cores)
- `--batch-size, -b`: Batch size for writing to Parquet (default: 100,000)
- `--follow-symlinks, -f`: Follow symbolic links
- `--max-depth, -m`: Maximum depth to scan (unlimited if not specified)
- `--verbose, -v`: Enable verbose logging
- `--incremental`: Enable incremental output mode (creates multiple readable chunk files)
- `--rows-per-chunk`: Rows per chunk in incremental mode (default: 500,000)
- `--chunk-interval-secs`: Time interval between chunks in seconds (default: 300)
- `--resume`: Resume an interrupted scan (requires --incremental)

### Incremental Output Mode

For long-running scans, you can enable incremental output mode which creates multiple readable Parquet files during the scan:

```bash
storage-scanner scan \
    --path /large/directory \
    --output scan.parquet \
    --incremental \
    --rows-per-chunk 500000 \
    --chunk-interval-secs 300
```

**Why use incremental mode?**

Standard Parquet files cannot be read until the scan completes because the file footer (with metadata) is only written when the writer closes. For multi-hour scans, this means you cannot inspect any results until completion.

Incremental mode solves this by:
- Creating multiple complete, readable Parquet files (chunks) during the scan
- Each chunk is a valid Parquet file that can be read immediately
- Chunks are created when either condition is met:
  - Row count threshold reached (e.g., 500,000 rows)
  - Time interval elapsed (e.g., 5 minutes)

**Output structure:**

```
scan_chunk_0001.parquet    # First chunk (complete, readable)
scan_chunk_0002.parquet    # Second chunk (complete, readable)
scan_chunk_0003.parquet    # Third chunk (in progress)
scan_manifest.json         # Manifest tracking all chunks and progress
```

**Reading incremental output:**

```python
# Python with Polars (recommended)
import polars as pl
df = pl.read_parquet('scan_chunk_*.parquet')

# Python with Pandas
import pandas as pd
import glob
files = glob.glob('scan_chunk_*.parquet')
df = pd.concat([pd.read_parquet(f) for f in files])

# Python with PyArrow
import pyarrow.parquet as pq
import glob
files = glob.glob('scan_chunk_*.parquet')
tables = [pq.read_table(f) for f in files]
table = pq.lib.concat_tables(tables)
```

**Monitoring progress during scan:**

```python
# Check manifest for progress
import json
with open('scan_manifest.json') as f:
    manifest = json.load(f)

print(f"Rows scanned: {manifest['total_rows']}")
print(f"Chunks completed: {manifest['chunk_count']}")
print(f"Scan complete: {manifest['completed']}")

# Read completed chunks (excluding last chunk if scan is in progress)
import polars as pl
safe_chunks = manifest['chunks'][:-1] if not manifest['completed'] else manifest['chunks']
df = pl.read_parquet([c['file_path'] for c in safe_chunks])
```

**When to use incremental mode:**

- ✅ Scans expected to take > 1 hour
- ✅ Need to monitor progress and view partial results
- ✅ Want ability to analyze data while scan continues
- ✅ Need resume capability if scan is interrupted
- ❌ Quick scans (< 30 minutes) where standard mode is simpler

### Resume Capability

**NEW:** The scanner now supports resuming interrupted scans when using incremental mode! This is especially valuable for large filesystems (>1TB, >1M files) where scans may take hours or days.

#### How Resume Works

When you run a scan with `--incremental` and `--resume`:

1. **Checkpoint Tracking**: The scanner saves progress in a manifest file (`_manifest.json`) that tracks which top-level directories have been fully scanned
2. **Smart Skip**: On resume, already-completed directories are skipped entirely - no re-scanning required
3. **Seamless Continuation**: The scanner picks up where it left off, continuing to write new chunks
4. **No Data Loss**: All completed chunks remain valid and readable

#### Resume Example

```bash
# Start a large scan
./scanner/target/release/storage-scanner scan \
    --path /large/dataset \
    --output scan_output.parquet \
    --incremental \
    --rows-per-chunk 500000 \
    --resume \
    --verbose

# If interrupted (Ctrl+C, crash, timeout), just run the SAME command again:
./scanner/target/release/storage-scanner scan \
    --path /large/dataset \
    --output scan_output.parquet \
    --incremental \
    --rows-per-chunk 500000 \
    --resume \
    --verbose

# The scanner will:
# - Load the existing manifest
# - Skip already-completed directories
# - Continue scanning remaining directories
# - Append new chunks with sequential numbering
```

#### Resume Output

```
Found existing manifest, resuming scan...
Resume state:
  - Completed directories: 42
  - Existing chunks: 8
  - Rows already scanned: 3,847,291
Skipping 42 already-completed directories:
  - user_data_01
  - user_data_02
  - projects
  ... and 39 more
Starting scan of: /large/dataset
```

#### Understanding Resume Granularity

The scanner resumes at **top-level directory** granularity:

```
/data/
├── user1/        ← Top-level dir (50K files) ✓ Completed
├── user2/        ← Top-level dir (30K files) ✓ Completed
├── user3/        ← Top-level dir (40K files) ⚠️  Partial - will re-scan
└── user4/        ← Top-level dir (60K files) ▶️  Not started - will scan
```

**Why directory-level?**
- **Safe**: Ensures data consistency - no risk of partial file lists
- **Efficient**: Skips large completed sections without complex state
- **Performance**: Only re-scans the last partial directory (minimal overhead)

For a filesystem with 100 top-level directories, if the scan interrupts after completing 95 directories, you only re-scan ~5% of the data.

#### Performance Impact

**Scenario**: Scanning 10TB filesystem with 5M files across 50 top-level directories

| Scan State | Without Resume | With Resume |
|------------|----------------|-------------|
| Interrupted at 80% | Re-scan 100% (4-6 hours) | Re-scan ~2% (5-10 minutes) |
| Completed 45/50 dirs | Start from scratch | Skip 45 dirs, scan 5 |
| Time saved | 0 | ~3-5 hours |

#### Best Practices

1. **Always use `--resume` for long scans** - It's safe to use even on fresh scans (no-op if no manifest exists)
2. **Keep same parameters** - Use identical `--output`, `--rows-per-chunk`, and `--chunk-interval-secs`
3. **Check the manifest** - After interruption, inspect `*_manifest.json` to see progress
4. **Disk space** - Ensure enough space for new chunks before resuming

#### Limitations

- ❌ **Resume requires `--incremental`** - Standard mode doesn't support resume
- ❌ **Don't change scan parameters** - Changing `--path` or chunk sizes may cause issues
- ⚠️ **Partial directory re-scan** - The directory being scanned when interrupted will be re-scanned (safe but slight overhead)
- ⚠️ **No change detection** - Resume doesn't detect file modifications in completed directories

### Examples

#### Scan with Limited Depth

```bash
storage-scanner scan \
    --path /project/cil \
    --output cil_shallow.parquet \
    --max-depth 5
```

#### Scan with Custom Thread Count

```bash
storage-scanner scan \
    --path /large/dataset \
    --output dataset.parquet \
    --threads 16
```

#### Verbose Output

```bash
storage-scanner scan \
    --path /project \
    --output project.parquet \
    --verbose
```

## Slurm Integration (HPC Clusters)

For large-scale scans on HPC clusters, use Slurm job arrays to scan multiple directories in parallel. This is ideal for scanning shared filesystems like `/project/cil` with multiple top-level directories.

### Parallel Scanning with Job Arrays

The recommended approach is to use **one job per top-level directory** to maximize parallelism and enable independent resume capability.

#### Example: Scanning `/project/cil` Directories

```bash
# Directory structure
ls /project/cil
# battuta-shares-S3-archive  battuta_shares  gcp  home_dirs  kupe_shares  norgay  sacagawea_shares
```

**Step 1: Create Slurm script** (`scan_cil_parallel.sh`)

```bash
#!/bin/bash
#SBATCH --job-name=cil_scan
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=8
#SBATCH --ntasks=1
#SBATCH --mem-per-cpu=4G
#SBATCH --time=24:00:00
#SBATCH --array=0-6
#SBATCH -o ./slurm_out/scan_%a.out
#SBATCH -e ./slurm_out/scan_%a.err

# Define directories to scan (must match array size)
DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

# Get directory for this array task
DIR=${DIRS[$SLURM_ARRAY_TASK_ID]}
BASE_PATH="/project/cil"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
DATE=$(date +%Y-%m-%d)

echo "================================================"
echo "Scanning: ${BASE_PATH}/${DIR}"
echo "Array Task ID: ${SLURM_ARRAY_TASK_ID}"
echo "Node: $(hostname)"
echo "Start Time: $(date)"
echo "================================================"

# Create output directory
mkdir -p ${OUTPUT_DIR}

# Run scanner with resume capability
./scanner/target/release/storage-scanner scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads 8 \
    --batch-size 50000 \
    --incremental \
    --resume \
    --verbose

EXIT_CODE=$?

echo "================================================"
echo "Scan completed with exit code: ${EXIT_CODE}"
echo "End Time: $(date)"
echo "Output: ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet"
echo "================================================"

exit ${EXIT_CODE}
```

**Step 2: Create output directory and submit**

```bash
# Create directory for Slurm logs
mkdir -p slurm_out

# Build scanner
cd scanner && cargo build --release && cd ..

# Submit job array
sbatch scan_cil_parallel.sh
```

**Step 3: Monitor progress**

```bash
# Check job status
squeue -u $USER

# Watch live output from one job
tail -f slurm_out/scan_0.out

# Check all completed jobs
ls slurm_out/scan_*.out | xargs grep "Scan completed"

# Check for errors
ls slurm_out/scan_*.err | xargs grep -i error
```

### Resuming Failed Jobs

If a job fails or times out, simply **resubmit the same job**. The `--resume` flag will automatically pick up where it left off:

```bash
# Resubmit the entire job array (only failed jobs will actually re-scan)
sbatch scan_cil_parallel.sh

# Or resubmit specific array indices that failed
sbatch --array=2,5 scan_cil_parallel.sh
```

### Optimized Configuration for Large Directories

For very large directories (>1TB, >1M files), adjust parameters:

```bash
#!/bin/bash
#SBATCH --job-name=cil_scan_large
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=16        # More threads for faster scanning
#SBATCH --ntasks=1
#SBATCH --mem-per-cpu=4G          # 64GB total memory
#SBATCH --time=48:00:00           # Longer time limit
#SBATCH --array=0-6
#SBATCH -o ./slurm_out/scan_%a.out
#SBATCH -e ./slurm_out/scan_%a.err

# ... same DIRS array ...

# Optimized scanner parameters
./scanner/target/release/storage-scanner scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads 16 \
    --batch-size 100000 \
    --incremental \
    --rows-per-chunk 1000000 \
    --chunk-interval-secs 600 \
    --resume \
    --verbose
```

### Alternative: Single Job with Sequential Scanning

For smaller directories or to minimize job count:

```bash
#!/bin/bash
#SBATCH --job-name=cil_scan_all
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=8
#SBATCH --ntasks=1
#SBATCH --mem=32G
#SBATCH --time=72:00:00
#SBATCH -o ./slurm_out/scan_all.out
#SBATCH -e ./slurm_out/scan_all.err

DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

BASE_PATH="/project/cil"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
DATE=$(date +%Y-%m-%d)

mkdir -p ${OUTPUT_DIR}

# Scan each directory sequentially
for DIR in "${DIRS[@]}"; do
    echo "Starting scan: ${DIR}"

    ./scanner/target/release/storage-scanner scan \
        --path "${BASE_PATH}/${DIR}" \
        --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
        --threads 8 \
        --incremental \
        --resume \
        --verbose

    if [ $? -eq 0 ]; then
        echo "✓ Completed: ${DIR}"
    else
        echo "✗ Failed: ${DIR}"
    fi
done

echo "All scans completed"
```

### Collecting Results

After all jobs complete, collect the parquet files:

```bash
# Check total output size
du -sh /scratch/midway3/${USER}/cil_scans

# List all chunk files
ls -lh /scratch/midway3/${USER}/cil_scans/*_chunk_*.parquet

# Count total chunks across all directories
ls /scratch/midway3/${USER}/cil_scans/*_chunk_*.parquet | wc -l

# Import all scans to backend
cd backend
for dir in battuta-shares-S3-archive battuta_shares gcp home_dirs kupe_shares norgay sacagawea_shares; do
    python scripts/import_snapshot.py \
        /scratch/midway3/${USER}/cil_scans/ \
        ${dir}_$(date +%Y-%m-%d)
done
```

### Performance Expectations

**Example benchmarks on RCC Midway3:**

| Directory | Size | Files | Threads | Time | Throughput |
|-----------|------|-------|---------|------|------------|
| home_dirs | 2.5TB | 3.2M | 16 | 2.5h | 21K files/sec |
| battuta_shares | 8TB | 5.1M | 16 | 4.2h | 20K files/sec |
| gcp | 450GB | 850K | 8 | 45min | 19K files/sec |

**Parallelism benefits:**
- **Sequential** (1 job): 7 dirs × 3h avg = ~21 hours
- **Parallel** (7 jobs): ~4 hours (limited by slowest job)
- **Time saved**: ~17 hours ✅

### Troubleshooting Slurm Jobs

**Job times out:**
```bash
# Check how far it got
grep "Rows already scanned" slurm_out/scan_X.out

# Increase time limit and resubmit
sbatch --time=48:00:00 scan_cil_parallel.sh
```

**Out of memory:**
```bash
# Reduce batch size or increase memory
#SBATCH --mem-per-cpu=8G  # Double the memory

# Or reduce batch size in scanner command
--batch-size 20000
```

**Permission denied:**
```bash
# Run scanner as the data owner or request access
# Check file permissions
ls -ld /project/cil/home_dirs
```

### Best Practices for RCC Scanning

1. **Use scratch space** - Write outputs to `/scratch/midway3/$USER` not `/project`
2. **Job arrays for parallelism** - One job per top-level directory
3. **Always use `--resume`** - Safe even on fresh scans
4. **Monitor first job** - Test with one directory before submitting all
5. **Incremental mode** - Required for long scans and resume
6. **Appropriate time limits** - Start with 24h, increase if needed
7. **Check quotas** - Ensure sufficient scratch space (`quota` command)

### Ready-to-Use Scripts

Pre-configured Slurm scripts are available in [`scanner/scripts/`](scripts/):

**`scan_cil_parallel.sh`** - Standard parallel scan
```bash
mkdir -p slurm_out
sbatch scanner/scripts/scan_cil_parallel.sh
```

**`scan_cil_large.sh`** - Optimized for large directories (16 CPUs, 48h)
```bash
sbatch scanner/scripts/scan_cil_large.sh
```

**Monitor progress:**
```bash
squeue -u $USER                           # Check job status
tail -f slurm_out/scan_0.out              # Watch live output
ls slurm_out/scan_*.out | xargs grep "Scan completed"  # Check completion
```

**Resume failed jobs:**
```bash
sbatch scanner/scripts/scan_cil_parallel.sh           # Resubmit all
sbatch --array=2,5 scanner/scripts/scan_cil_parallel.sh  # Specific jobs
```

## Output Format

The scanner outputs data in Apache Parquet format with the following schema:

| Column          | Type    | Description                           |
|-----------------|---------|---------------------------------------|
| path            | String  | Full absolute path                    |
| size            | UInt64  | File size in bytes                    |
| modified_time   | Int64   | Last modified time (Unix timestamp)   |
| accessed_time   | Int64   | Last accessed time (Unix timestamp)   |
| created_time    | Int64   | Creation time (Unix timestamp)        |
| file_type       | String  | File extension or 'directory'         |
| inode           | UInt64  | Inode number                          |
| permissions     | UInt32  | Unix permissions (octal)              |
| parent_path     | String  | Parent directory path                 |
| depth           | UInt32  | Depth from scan root                  |
| top_level_dir   | String  | Top-level directory name              |

### Reading Parquet Files

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

df = pl.read_parquet('scan_output.parquet')
print(df.head())
```

#### Python (Pandas)

```python
import pandas as pd

df = pd.read_parquet('scan_output.parquet')
print(df.head())
```

## Development

### Running Tests

```bash
# Run all tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Run integration tests only
cargo test --test integration_tests

# Run specific test
cargo test test_scan_directory_basic
```

### Running Benchmarks

The scanner includes a comprehensive benchmark suite to measure performance:

```bash
# Quick method: Use the benchmark script
./scanner/scripts/run_benchmarks.sh

# Or run benchmarks manually
cd scanner

# Run all benchmarks (takes 5-10 minutes)
cargo bench

# Run specific benchmark groups
cargo bench -- scan_small_files      # Test with small files
cargo bench -- scan_nested            # Test nested directories
cargo bench -- parallel_comparison    # Compare thread counts
cargo bench -- batch_sizes            # Test different batch sizes
cargo bench -- max_depth              # Test depth limiting

# View detailed HTML reports
open target/criterion/report/index.html  # macOS
xdg-open target/criterion/report/index.html  # Linux
```

**What the benchmarks measure:**

1. **Small Files Benchmark** (`scan_small_files`)
   - Tests: 100, 500, 1000 files
   - Measures: Files/second throughput
   - Shows: Performance scaling with file count

2. **Nested Directories** (`scan_nested`)
   - Tests: 3, 5, 7 levels deep
   - Measures: Performance with deep hierarchies
   - Shows: Impact of directory depth

3. **Parallel vs Sequential** (`parallel_comparison`)
   - Tests: 1, 2, 4, 8 threads
   - Measures: Scalability across cores
   - Shows: Optimal thread count for your hardware

4. **Batch Sizes** (`batch_sizes`)
   - Tests: 100, 1000, 10000 entries per batch
   - Measures: Memory vs throughput tradeoff
   - Shows: Optimal batch size

5. **Max Depth** (`max_depth`)
   - Tests: Depth 2, 4, unlimited
   - Measures: Performance of depth limiting
   - Shows: Impact of max_depth option

**Interpreting Results:**

```
scan_small_files/1000   time:   [12.345 ms 12.456 ms 12.567 ms]
                        thrpt:  [79,562 elem/s 80,257 elem/s 81,003 elem/s]
```

- `time`: How long the benchmark took (lower is better)
- `thrpt`: Throughput in elements (files) per second (higher is better)
- Three values show: [lower bound, estimate, upper bound]

**Performance Tips from Benchmarks:**
- Use 4-8 threads for typical workloads
- Batch size of 100,000 works well for most cases
- Deep hierarchies (>10 levels) may benefit from more threads
- SSD/NVMe storage shows better scaling with higher thread counts

### Generating Test Fixtures

The mock filesystem generator creates a realistic test directory structure for testing the scanner:

```bash
# Navigate to fixtures directory
cd scanner/tests/fixtures

# Generate mock filesystem
./generate_fixtures.sh

# This creates a test_project directory with:
# - 100 small files (1KB each) in small_files/
# - 10 large files (10MB each) in large_files/
# - Nested directory structure (4 levels deep)
# - Mixed file types (.txt, .py, .json, .csv, .pdf, .png, etc.)
# - Special cases (hidden files, Unicode names, spaces, symlinks)
# - Directory with 500 log files
# Total: ~800 files, ~110 MB

# View the generated structure
tree test_project -L 2  # If tree is installed
# Or use:
find test_project -type d | head -20

# Scan the test data
cd ../..
cargo run --release -- scan \
    --path tests/fixtures/test_project \
    --output /tmp/test_scan.parquet \
    --verbose

# Verify the output
ls -lh /tmp/test_scan.parquet

# Read the parquet file (requires Python with pandas/polars)
python3 -c "import pandas as pd; df = pd.read_parquet('/tmp/test_scan.parquet'); print(df.info()); print(df.head())"
```

**What the mock filesystem tests:**
- Small file handling (many tiny files)
- Large file handling (multi-MB files)
- Deep directory nesting (tests depth calculation)
- Various file extensions (tests file_type detection)
- Unicode and special characters in filenames
- Symbolic links (tests follow_symlinks option)
- Empty files (edge case)
- Hidden files (Unix dot files)

### Code Quality

```bash
# Run clippy (linter)
cargo clippy -- -D warnings

# Format code
cargo fmt

# Check formatting
cargo fmt -- --check
```

## Environment Setup

### Local Development (macOS/Linux)

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Clone and build
git clone <repository-url>
cd storage-analytics/scanner
cargo build --release
```

### HPC Cluster (with Conda)

```bash
# Load required modules (adjust for your system)
module load rust
module load gcc

# Or install Rust via Conda
conda create -n storage-scanner
conda activate storage-scanner
conda install -c conda-forge rust

# Build
cargo build --release
```

### Docker (Alternative)

```dockerfile
FROM rust:1.75 as builder

WORKDIR /app
COPY scanner/ ./scanner/
WORKDIR /app/scanner

RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/scanner/target/release/storage-scanner /usr/local/bin/

ENTRYPOINT ["storage-scanner"]
```

Build and run:

```bash
docker build -t storage-scanner .
docker run -v /data:/data storage-scanner scan --path /data --output /data/scan.parquet
```

## Understanding Scanner vs du Size Differences

You may notice that the scanner reports a different total size than the `du` command. This is **expected and normal**. Here's why:

### Example
```bash
# Scanner reports
Total file size: 877 MB

# du reports
du -sh /path
2.8 GB  # 3.2x larger!
```

### Why the Difference?

The scanner shows **879 MB** (actual file contents), while `du` shows **2.8 GB** (disk space used). Here's what accounts for the 2.0 GB difference:

1. **Block Size Overhead (~68% of difference)**
   - Filesystems allocate space in blocks (typically 4KB)
   - A 1-byte file still uses a full 4KB block
   - With 57,291 files × 4KB = ~223 MB overhead
   - Many small files waste significant space

2. **Filesystem Metadata**
   - Directory entries
   - Inode structures
   - File attributes and permissions
   - Extended attributes

3. **Sparse Files** (if present)
   - Scanner counts apparent size
   - `du` counts allocated blocks

4. **Journaling and Snapshots** (filesystem dependent)
   - Journal overhead
   - Snapshot metadata

### Which Number is "Correct"?

Both are correct, but they measure different things:

- **Scanner (877 MB)**: Actual data in your files
  - Use this for: Data transfer estimates, backup size planning
  - Answers: "How much data do I have?"

- **du (2.8 GB)**: Disk space consumed
  - Use this for: Disk quota monitoring, capacity planning
  - Answers: "How much disk space am I using?"

### Analyzing Your Scan

Use the analysis script to understand the breakdown:

```bash
./scanner/scripts/analyze_scan.py \
    /path/to/scan.parquet \
    --path /original/scanned/path

# Output shows:
# - File count and types
# - Actual file sizes
# - du comparison
# - Block overhead estimate
# - Largest files
```

**Rule of Thumb:**
- Many small files → large difference (2-3x)
- Few large files → small difference (<10%)
- Average file size < 4KB → very large difference (3-5x)

In your case: **Average file size is 15.68 KB**, with median of **967 bytes**, explaining the 3.2x multiplier.

## Troubleshooting

### Permission Errors

The scanner gracefully handles permission errors but logs them. To minimize errors:

```bash
# Run with appropriate permissions
sudo storage-scanner scan --path /protected --output scan.parquet

# Or adjust permissions beforehand
chmod -R +r /path/to/scan
```

### Out of Memory

If scanning extremely large directories:

```bash
# Reduce batch size
storage-scanner scan --path /huge --output scan.parquet --batch-size 10000
```

### Slow Performance

```bash
# Increase thread count
storage-scanner scan --path /data --output scan.parquet --threads 32

# Limit depth for shallow scans
storage-scanner scan --path /data --output scan.parquet --max-depth 5
```

### Parquet File Issues

```bash
# Verify parquet file
parquet-tools schema scan.parquet
parquet-tools cat scan.parquet | head

# Or use Python
python -c "import pandas as pd; print(pd.read_parquet('scan.parquet').info())"
```

## Performance Tuning

### Thread Count

- Start with number of CPU cores
- For I/O-bound workloads, try 2x CPU cores
- For CPU-bound workloads, use CPU cores or slightly less

```bash
# Get optimal thread count
nproc  # Linux
sysctl -n hw.ncpu  # macOS
```

### Batch Size

- Larger batches: Better throughput, more memory
- Smaller batches: Lower memory, more overhead
- Default (100,000) works well for most cases

### Storage Considerations

- NVMe/SSD: Higher thread counts perform better
- HDD: Lower thread counts to avoid thrashing
- Network storage: Moderate thread count (4-8)

## Logging

The scanner uses structured logging with different levels:

```bash
# Info level (default)
storage-scanner scan --path /data --output scan.parquet

# Debug level (verbose)
storage-scanner scan --path /data --output scan.parquet --verbose

# Control via environment variable
RUST_LOG=debug storage-scanner scan --path /data --output scan.parquet
```

## Project Structure

```
scanner/
├── Cargo.toml              # Project configuration
├── README.md               # This file
├── src/
│   ├── main.rs            # CLI entry point
│   ├── lib.rs             # Library exports
│   ├── models.rs          # Data structures
│   ├── scanner.rs         # Core scanning logic
│   ├── writer.rs          # Parquet writer
│   └── utils.rs           # Utility functions
├── tests/
│   ├── integration_tests.rs   # Integration tests
│   └── fixtures/
│       ├── generate_fixtures.sh
│       └── test_project/
├── benches/
│   └── scan_benchmark.rs  # Performance benchmarks
└── scripts/
    ├── slurm_scan.sh      # Slurm job script
    └── scan_wrapper.py    # Python wrapper
```

## Contributing

See the main project documentation for contribution guidelines.

## License

MIT License

## Support

For issues, questions, or feature requests, please open an issue in the project repository.
