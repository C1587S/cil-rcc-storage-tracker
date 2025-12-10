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

## Slurm Integration

For HPC environments, use the provided Slurm scripts to scan multiple directories in parallel.

### Quick Start

```bash
# Build the scanner
cargo build --release

# Submit Slurm job array
sbatch scanner/scripts/slurm_scan.sh
```

### Using the Python Wrapper

The Python wrapper provides a convenient interface for job submission and monitoring:

```bash
# Submit a scan job
./scanner/scripts/scan_wrapper.py submit \
    --scanner-bin ./target/release/storage-scanner \
    --snapshot-dir /snapshots/2024-01-15 \
    --cpus 16 \
    --memory 8G \
    --time 4:00:00

# Check job status
./scanner/scripts/scan_wrapper.py status <job-id>

# List snapshots
./scanner/scripts/scan_wrapper.py list --snapshot-dir /snapshots
```

### Customizing Scan Directories

Edit the `DIRS` array in [scanner/scripts/slurm_scan.sh](scripts/slurm_scan.sh#L16-L24):

```bash
DIRS=(
    "your_dir_1"
    "your_dir_2"
    "your_dir_3"
)
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
