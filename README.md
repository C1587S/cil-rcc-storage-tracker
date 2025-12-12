# Storage Analytics System

High-performance storage analytics for scanning, indexing, and visualizing file systems with billions of files.

## Features

- **Fast Scanning**: Rust scanner with parallel processing (50K+ files/sec)
- **Resume Capability**: Interrupt and resume large scans without losing progress
- **Incremental Output**: View partial results while scanning is in progress
- **OLAP Analytics**: DuckDB with columnar Parquet storage
- **Instant Queries**: Materialized tables for sub-second response (optimized for 1M+ files)
- **Interactive Dashboard**: Next.js with professional visualizations
- **Historical Snapshots**: Track storage changes over time

## Quick Start

```bash
# Complete workflow in one command
./scripts/scan_and_deploy.sh /path/to/scan
```

Wait 10-15 seconds, then open **http://localhost:3000** in incognito mode.

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
mamba create  --prefix /project/cil/home_dirs/rcc/envs/storage_scanner -f environment.yml # force prefix

# Activate the new environment
source activate /project/cil/home_dirs/rcc/envs/storage_scanner

# Build the Rust scanner
cd scanner
cargo build --release
cd ..
```

The environment includes all dependencies for:
- Rust scanner compilation
- Python backend (FastAPI, DuckDB, Polars)
- Report generation (matplotlib, seaborn)

## Manual Steps

See [COMPLETE_GUIDE.md](COMPLETE_GUIDE.md) for detailed instructions.

### 1. Build Scanner
```bash
cd scanner && cargo build --release && cd ..
```

### 2. Scan Directory
```bash
# Quick scan (small directories)
./scanner/target/release/storage-scanner scan \
    --path /your/directory \
    --output scan_testing/snapshot_$(date +%Y-%m-%d).parquet

# Large scan with resume capability (recommended for >1TB or >1M files)
./scanner/target/release/storage-scanner scan \
    --path /your/large/directory \
    --output scan_testing/snapshot_$(date +%Y-%m-%d).parquet \
    --incremental \
    --resume \
    --verbose
```

### 3. Import & Optimize
```bash
cd backend
python scripts/import_snapshot.py ../scan_testing $(date +%Y-%m-%d)
python scripts/optimize_snapshot.py $(date +%Y-%m-%d)
```

### 4. Start Services
```bash
# Backend
cd backend && uvicorn app.main:app --reload &

# Frontend
cd frontend && npm run dev &
```

## Performance

| Files | API Response | Optimization Time |
|-------|--------------|-------------------|
| 113K  | 0.05s        | 0.04s            |
| 1M+   | 0.28s        | 0.24s            |
| 10M+  | ~1s          | ~2s              |

## Tech Stack

- **Scanner**: Rust (jwalk, rayon, parquet)
- **Backend**: Python (FastAPI, DuckDB, Polars)
- **Frontend**: Next.js 14 (React, TypeScript, Nivo)

## Key Insight: Materialized Tables

The system pre-computes aggregations during import (`optimize_snapshot.py`) to make queries instant. This is critical for large datasets.

**Without optimization**: API timeout (>30s)
**With optimization**: 0.05-0.28s ✅

## Project Structure

```
storage-analytics/
├── scanner/          # Rust scanner
├── backend/          # Python FastAPI + DuckDB
├── frontend/         # Next.js dashboard
└── scripts/          # Automation scripts
```

## Documentation

- **[COMPLETE_GUIDE.md](COMPLETE_GUIDE.md)** - Full walkthrough from scan to dashboard
- **[CLAUDE.md](CLAUDE.md)** - Original project plan and architecture

## Troubleshooting

### Frontend shows old data
```bash
# Open in incognito mode, or:
rm -rf frontend/.next frontend/node_modules/.cache
```

### Database corrupted
```bash
rm -rf backend/data/storage_analytics.duckdb*
# Then re-import and optimize
```

### API timeout
```bash
cd backend
python scripts/optimize_snapshot.py 2025-12-11
```

See [COMPLETE_GUIDE.md#troubleshooting](COMPLETE_GUIDE.md#troubleshooting) for more.

## Production Deployment

The system is designed to scale to billions of files using:
- Partitioned Parquet storage
- DuckDB indexes
- Incremental scanning with resume capability
- Directory-level checkpoint tracking
- Distributed storage (S3/MinIO)

See [COMPLETE_GUIDE.md#scaling-to-billions-of-files](COMPLETE_GUIDE.md#scaling-to-billions-of-files) for details.

## Resume Capability for Large Scans

For large filesystems (>1TB, >1M files), the scanner supports resuming interrupted scans:

```bash
# Start scan with resume enabled
./scanner/target/release/storage-scanner scan \
    --path /massive/dataset \
    --output scan.parquet \
    --incremental \
    --resume \
    --verbose

# If interrupted, run the SAME command to continue
# The scanner automatically:
# - Loads checkpoint from manifest
# - Skips already-completed directories
# - Continues from where it left off
# - No data loss or re-scanning
```

**Performance**: For a 10TB scan interrupted at 80% completion, resume saves ~3-5 hours by skipping already-scanned directories.

See [scanner/README.md#resume-capability](scanner/README.md#resume-capability) for detailed documentation.

## License

MIT

---

**Current Snapshot**: 113,338 files (1.01 GB) ready to explore

**Quick Access**: http://localhost:3000
