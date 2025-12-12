# Storage Analytics System

High-performance storage analytics for scanning, indexing, and visualizing file systems with millions of files.

## Features

- **Fast Scanning**: Rust scanner with parallel processing (50K+ files/sec)
- **Resume Capability**: Interrupt and resume large scans without losing progress
- **Incremental Output**: View partial results while scanning is in progress
- **Owner/Group Tracking**: Identify storage usage by user and group
- **OLAP Analytics**: DuckDB with columnar Parquet storage
- **Instant Queries**: Materialized tables for sub-second response (optimized for 1M+ files)
- **Interactive Dashboard**: Next.js with professional visualizations
- **Historical Snapshots**: Track storage changes over time

## Table of Contents

1. [RCC HPC Environment Setup](#rcc-hpc-environment-setup)
2. [Part 1: Using the Scanner](#part-1-using-the-scanner)
3. [Part 2: Generating Reports](#part-2-generating-reports)
4. [Part 3: Web Dashboard](#part-3-web-dashboard)
5. [Troubleshooting](#troubleshooting)

---

## RCC HPC Environment Setup

For deployment on the RCC HPC cluster, create the conda environment:

```bash
# Navigate to project directory
cd /project/cil/home_dirs/scadavidsanchez/projects/scanner-scc

# Load Python module
module load python

# Activate mamba base environment
source activate /project/cil/home_dirs/scadavidsanchez/envs/mamba_base

# Create the storage scanner environment
mamba create --prefix /project/cil/home_dirs/rcc/envs/storage_scanner -f environment.yml

# Activate the new environment
source activate /project/cil/home_dirs/rcc/envs/storage_scanner

# Build and install the Rust scanner
cd scanner
cargo install --path . --root "$CONDA_PREFIX"
cd ..
```

The environment includes all dependencies for:
- Rust scanner compilation
- Python backend (FastAPI, DuckDB, Polars)
- Report generation (matplotlib, seaborn)

---

## Part 1: Using the Scanner

### Build the Scanner

```bash
cd scanner
cargo build --release
cd ..
```

### Basic Scan (Small Directories)

For small directories (<100K files, <100GB):

```bash
./scanner/target/release/storage-scanner scan \
    --path /path/to/directory \
    --output scan_examples/snapshot_$(date +%Y-%m-%d).parquet \
    --verbose
```

### Incremental Scan with Resume Capability (Recommended)

**For large filesystems (>1M files, >1TB)**, use incremental output with resume capability:

```bash
./scanner/target/release/storage-scanner scan \
    --path /path/to/large/directory \
    --output scan_examples/snapshot_$(date +%Y-%m-%d).parquet \
    --threads 10 \
    --batch-size 20000 \
    --incremental \
    --resume \
    --rows-per-chunk 10000 \
    --chunk-interval-secs 60 \
    --verbose
```

**How it works:**

1. **`--incremental`**: Writes data to disk periodically (every 60 seconds or 10,000 rows)
2. **`--resume`**: Saves checkpoints to a manifest file, tracking completed directories
3. **If interrupted**: Run the **exact same command** again to continue from where it left off
4. **No data loss**: Already-scanned directories are skipped automatically

**Example workflow:**

```bash
# Start scan
./scanner/target/release/storage-scanner scan \
    --path /project/cil/gcp \
    --output scan_examples/gcp_scan.parquet \
    --incremental \
    --resume \
    --verbose

# If interrupted (Ctrl+C or job timeout), just re-run the same command:
./scanner/target/release/storage-scanner scan \
    --path /project/cil/gcp \
    --output scan_examples/gcp_scan.parquet \
    --incremental \
    --resume \
    --verbose

# Scanner will:
# - Load checkpoint from scan_examples/gcp_scan.manifest.json
# - Skip already-completed directories
# - Continue scanning from where it stopped
```

**Performance benefit**: For a 10TB scan interrupted at 80%, resume saves ~3-5 hours by avoiding re-scanning.

### Scanner Options Explained

| Option | Default | Description |
|--------|---------|-------------|
| `--path` | Required | Directory to scan |
| `--output` | Required | Output parquet file path |
| `--threads` | Auto | Number of parallel threads (use 8-16 for HPC) |
| `--batch-size` | 10000 | Files per batch before writing |
| `--incremental` | Off | Enable periodic writes during scan |
| `--resume` | Off | Save checkpoints for resuming interrupted scans |
| `--rows-per-chunk` | 10000 | Rows per incremental write |
| `--chunk-interval-secs` | 60 | Seconds between incremental writes |
| `--verbose` | Off | Show detailed progress |

### Output Files

After scanning, you'll have:
- `scan_examples/snapshot_YYYY-MM-DD.parquet` - Main data file
- `scan_examples/snapshot_YYYY-MM-DD.manifest.json` - Checkpoint file (if using `--resume`)

### Data Fields Collected

The scanner collects the following information for each file:

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Full absolute path |
| `size` | uint64 | File size in bytes |
| `modified_time` | int64 | Last modified timestamp (Unix epoch) |
| `accessed_time` | int64 | Last accessed timestamp |
| `created_time` | int64 | Creation timestamp (if available) |
| `file_type` | string | File extension or "directory" |
| `inode` | uint64 | Inode number |
| `permissions` | uint32 | Unix permissions (octal) |
| `uid` | uint32 | User ID (owner) |
| `gid` | uint32 | Group ID |
| `owner` | string | Username (resolved from uid) |
| `group` | string | Group name (resolved from gid) |
| `parent_path` | string | Parent directory path |
| `depth` | uint32 | Depth from scan root |
| `top_level_dir` | string | Top-level directory name |

The **owner and group information** is particularly useful for multi-user storage systems like RCC to identify which users are consuming the most storage.

---

## Part 2: Generating Reports

The `reports/` folder contains Python scripts to generate markdown reports from scan results.

### Prerequisites

```bash
cd reports
pip install -r requirements.txt
```

### Generate a Report

```bash
python generate_report.py \
    --input ../scan_examples/snapshot_2025-12-12.parquet \
    --output reports/storage_report_2025-12-12.md
```

### What Reports Include

- **Summary Statistics**: Total files, total size, average file size
- **File Type Breakdown**: Distribution by extension
- **Size Distribution**: Histograms and percentiles
- **Top Directories**: Largest directories by size and file count
- **Top Files**: Largest individual files
- **Owner/Group Analysis**: Storage consumption by user and group
- **Visualizations**: Charts embedded as images

### Example Report Output

```markdown
# Storage Report - 2025-12-12

## Summary
- Total Files: 1,234,567
- Total Size: 5.2 TB
- Average File Size: 4.3 MB

## Top 10 Largest Directories
1. /project/cil/gcp/dataset_01 - 1.2 TB (234,123 files)
2. /project/cil/gcp/logs - 856 GB (456,789 files)
...

## Top 10 Storage Users
1. user123 - 850 GB (125,000 files)
2. user456 - 620 GB (89,000 files)
...
```

---

## Part 3: Web Dashboard

The web dashboard provides an interactive interface to explore scan results.

### Step 1: Import Scan Results

```bash
cd backend

# Import the parquet file
python scripts/import_snapshot.py \
    ../scan_examples \
    2025-12-12

# CRITICAL: Optimize for performance (creates materialized tables)
python scripts/optimize_snapshot.py 2025-12-12
```

**What optimization does:**
- Pre-computes aggregations for instant queries
- Creates materialized summary tables
- **Essential for large datasets** (1M+ files)

**Performance:**
- Without optimization: 30+ seconds (timeout)
- With optimization: 0.3 seconds ✅

### Step 2: Start Backend API

```bash
cd backend
uvicorn app.main:app --reload
```

Verify it's working:
```bash
curl http://localhost:8000/api/snapshots/
```

### Step 3: Start Frontend Dashboard

```bash
cd frontend
npm install  # First time only
npm run dev
```

Access dashboard: **http://localhost:3000**

### Dashboard Features

- **Overview**: Total files, size, trends
- **Directory Browser**: Navigate file tree with size breakdowns
- **File Type Analysis**: Pie charts and breakdowns by extension
- **Large Files**: Top 1000 largest files
- **User/Group Analytics**: Storage consumption by owner and group
- **Historical Comparison**: Track storage growth over time (multiple snapshots)

### Complete Workflow Script

For convenience, use the automated script:

```bash
./scripts/scan_and_deploy.sh /path/to/scan
```

This will:
1. Scan the directory
2. Import and optimize the data
3. Start backend and frontend
4. Open http://localhost:3000

---

## Troubleshooting

### Frontend Shows Old Data

**Problem**: Browser caching previous snapshot

**Solution**:
```bash
# Stop servers
pkill -f "next dev"
pkill -f "uvicorn"

# Clear frontend cache
cd frontend
rm -rf .next node_modules/.cache

# Restart
cd ../backend && uvicorn app.main:app --reload &
cd ../frontend && npm run dev &
```

Then open http://localhost:3000 in **incognito mode**

### API Timeout / Slow Queries

**Problem**: Snapshot not optimized

**Solution**:
```bash
cd backend
python scripts/optimize_snapshot.py 2025-12-12
```

### DuckDB Corrupted/Lock Error

**Problem**: Database locked or serialization error

**Solution**:
```bash
# Stop all services
pkill -f "uvicorn"
pkill -f "next dev"

# Delete corrupted database
rm -rf backend/data/storage_analytics.duckdb*

# Re-import and optimize
cd backend
python scripts/import_snapshot.py ../scan_examples 2025-12-12
python scripts/optimize_snapshot.py 2025-12-12
```

### Resume Not Working

**Problem**: Scanner re-scans everything instead of resuming

**Check**:
1. Are you using the **exact same** `--output` path?
2. Does the `.manifest.json` file exist?
3. Did you include both `--incremental` and `--resume` flags?

**Solution**:
```bash
# Verify manifest exists
ls -la scan_examples/*.manifest.json

# Make sure to use identical paths and flags
./scanner/target/release/storage-scanner scan \
    --path /same/path \
    --output scan_examples/same_name.parquet \
    --incremental \
    --resume \
    --verbose
```

---

## Performance Benchmarks

| Dataset Size | Scan Time | API Response | Optimization Time |
|--------------|-----------|--------------|-------------------|
| 100K files   | ~2 min    | 0.05s        | 0.04s            |
| 1M files     | ~20 min   | 0.28s        | 0.24s            |
| 10M files    | ~3 hrs    | ~1s          | ~2s              |

**Note**: Scan times assume SSD/NVMe storage and 8-16 threads.

---

## Production Deployment (RCC HPC)

### Slurm Job for Large Scans

```bash
#!/bin/bash
#SBATCH --job-name=storage-scan
#SBATCH --cpus-per-task=16
#SBATCH --mem=8G
#SBATCH --time=24:00:00

source activate /project/cil/home_dirs/rcc/envs/storage_scanner

SNAPSHOT_DATE=$(date +%Y-%m-%d)

# Scan with resume capability
storage-scanner scan \
    --path /project/cil/gcp \
    --output /snapshots/${SNAPSHOT_DATE}/gcp.parquet \
    --threads $SLURM_CPUS_PER_TASK \
    --batch-size 50000 \
    --incremental \
    --resume \
    --verbose

# Import and optimize
python backend/scripts/import_snapshot.py /snapshots/${SNAPSHOT_DATE} ${SNAPSHOT_DATE}
python backend/scripts/optimize_snapshot.py ${SNAPSHOT_DATE}
```

### Array Job for Multiple Directories

```bash
#!/bin/bash
#SBATCH --job-name=storage-scan
#SBATCH --array=0-6
#SBATCH --cpus-per-task=16
#SBATCH --mem=8G
#SBATCH --time=24:00:00

DIRS=(cil battuta-shares-S3-archive battuta_shares gcp home_dirs kupe_shares norgay sacagawea_shares)
SNAPSHOT_DATE=$(date +%Y-%m-%d)

source activate /project/cil/home_dirs/rcc/envs/storage_scanner

storage-scanner scan \
    --path /project/${DIRS[$SLURM_ARRAY_TASK_ID]} \
    --output /snapshots/${SNAPSHOT_DATE}/${DIRS[$SLURM_ARRAY_TASK_ID]}.parquet \
    --threads $SLURM_CPUS_PER_TASK \
    --incremental \
    --resume \
    --verbose
```

---

## Tech Stack

- **Scanner**: Rust (jwalk, rayon, parquet)
- **Backend**: Python (FastAPI, DuckDB, Polars)
- **Frontend**: Next.js 14 (React, TypeScript, Nivo)
- **Reports**: Python (matplotlib, seaborn, markdown)

---

## Project Structure

```
storage-analytics/
├── scanner/                    # Rust scanner
│   ├── src/                   # Source code
│   └── target/release/        # Compiled binary
├── backend/                    # Python FastAPI
│   ├── app/                   # API application
│   ├── data/                  # Storage
│   │   ├── snapshots/         # Parquet files by date
│   │   └── storage_analytics.duckdb
│   └── scripts/
│       ├── import_snapshot.py
│       └── optimize_snapshot.py  # Critical for performance
├── frontend/                   # Next.js dashboard
│   └── app/                   # React components
├── reports/                    # Report generation
│   ├── generate_report.py
│   └── requirements.txt
├── scan_examples/             # Scan output directory
├── scripts/                    # Automation scripts
│   └── scan_and_deploy.sh
└── environment.yml            # Conda environment spec
```

---

## License

MIT

---

**Quick Access**: http://localhost:3000
