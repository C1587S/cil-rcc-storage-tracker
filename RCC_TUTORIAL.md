# RCC Storage Tracker Tutorial

Complete workflow for scanning RCC filesystem and creating a ClickHouse database for visualization.

## Overview

This tutorial covers the complete process:
1. Scanning `/project/cil` filesystem using Slurm
2. Importing scan results into ClickHouse
3. Computing voronoi hierarchy for visualization
4. Running the web interface

## Prerequisites

- Access to RCC (Midway3)
- Conda/Mamba environment set up
- ClickHouse running (Docker or manual install)
- Scanner binary installed with `aggregate` command

## Part 1: Scanning the Filesystem

### Step 1: Rebuild Scanner (if needed)

Check if your scanner has the `aggregate` command:

```bash
storage-scanner --help
```

If you don't see `aggregate` in the commands list, rebuild:

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/scanner
cargo uninstall storage-scanner
cargo clean
cargo build --release
cargo install --path .

# Verify
storage-scanner --help  # Should now show 'aggregate' command
```

### Step 2: Create Output Directories

```bash
mkdir -p /project/cil/home_dirs/rcc/cil_scans/slurm_out
```

### Step 3: Submit Scan Job

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker

# Submit the job
sbatch scanner/scripts/scan_cil_large.sh
```

This launches 7 parallel jobs, one for each directory:
- `battuta-shares-S3-archive`
- `battuta_shares`
- `gcp`
- `home_dirs`
- `kupe_shares`
- `norgay`
- `sacagawea_shares`

### Step 4: Monitor Progress

```bash
# Check job status
squeue -u $USER

# Watch logs in real-time (example for job 0)
tail -f /project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_0.out

# Check for errors
tail /project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_*.err
```

### Step 5: Verify Scan Output

After all jobs complete, you should have:

```bash
tree /project/cil/home_dirs/rcc/cil_scans/
```

Expected structure:
```
cil_scans/
├── battuta_shares/
│   └── 2025-12-27/
│       ├── battuta_shares_2025-12-27.parquet
│       └── battuta_shares_2025-12-27_manifest.json
├── battuta-shares-S3-archive/
│   └── 2025-12-27/
│       ├── battuta-shares-S3-archive_2025-12-27.parquet
│       └── battuta-shares-S3-archive_2025-12-27_manifest.json
├── gcp/
│   └── 2025-12-27/
│       ├── gcp_2025-12-27.parquet
│       └── gcp_2025-12-27_manifest.json
├── home_dirs/
│   └── 2025-12-27/
│       ├── home_dirs_2025-12-27.parquet
│       └── home_dirs_2025-12-27_manifest.json
├── kupe_shares/
│   └── 2025-12-27/
│       ├── kupe_shares_2025-12-27.parquet
│       └── kupe_shares_2025-12-27_manifest.json
├── norgay/
│   └── 2025-12-27/
│       ├── norgay_2025-12-27.parquet
│       └── norgay_2025-12-27_manifest.json
└── sacagawea_shares/
    └── 2025-12-27/
        ├── sacagawea_shares_2025-12-27.parquet
        └── sacagawea_shares_2025-12-27_manifest.json
```

## Part 2: Setting Up ClickHouse

### Option A: Using Docker (Recommended)

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/clickhouse

# Start ClickHouse
docker compose up -d

# Wait for startup
sleep 10

# Check it's running
docker ps | grep clickhouse
```

### Option B: Manual ClickHouse Installation

If Docker is not available, install ClickHouse manually and start the server on `localhost:9000`.

### Initialize Database Schema

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/clickhouse

# Activate environment
module load python
source activate /project/cil/home_dirs/rcc/envs/storage_scanner

# Install dependencies
pip install -r requirements.txt

# Initialize database
python scripts/setup_database.py
```

Expected output:
```
Setting up ClickHouse database schema...
Executing 01_create_tables.sql...
  Executed: 15, Skipped: 0, Errors: 0
Executing 02_materialized_views.sql...
  Executed: 23, Skipped: 0, Errors: 0
Executing 03_recursive_directory_sizes.sql...
  Executed: 5, Skipped: 0, Errors: 0
Executing 04_voronoi_precomputed.sql...
  Executed: 1, Skipped: 0, Errors: 0
✓ Database 'filesystem' exists
✓ Table 'filesystem.entries' exists
✓ Table 'filesystem.snapshots' exists
✓ Table 'filesystem.search_index' exists
✓ Table 'filesystem.voronoi_precomputed' exists
✓ Found 9 materialized views
```

## Part 3: Importing Parquet Files into ClickHouse

You have 7 Parquet files to import for the same snapshot date. Import them all:

### Import Each Directory

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/clickhouse

# Set the snapshot date
SNAPSHOT_DATE="2025-12-27"
SCAN_BASE="/project/cil/home_dirs/rcc/cil_scans"

# Import each directory's Parquet file
python scripts/import_snapshot.py \
  "${SCAN_BASE}/battuta-shares-S3-archive/${SNAPSHOT_DATE}/battuta-shares-S3-archive_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}

python scripts/import_snapshot.py \
  "${SCAN_BASE}/battuta_shares/${SNAPSHOT_DATE}/battuta_shares_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}

python scripts/import_snapshot.py \
  "${SCAN_BASE}/gcp/${SNAPSHOT_DATE}/gcp_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}

python scripts/import_snapshot.py \
  "${SCAN_BASE}/home_dirs/${SNAPSHOT_DATE}/home_dirs_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}

python scripts/import_snapshot.py \
  "${SCAN_BASE}/kupe_shares/${SNAPSHOT_DATE}/kupe_shares_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}

python scripts/import_snapshot.py \
  "${SCAN_BASE}/norgay/${SNAPSHOT_DATE}/norgay_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}

python scripts/import_snapshot.py \
  "${SCAN_BASE}/sacagawea_shares/${SNAPSHOT_DATE}/sacagawea_shares_${SNAPSHOT_DATE}.parquet" \
  ${SNAPSHOT_DATE}
```

### Automated Import Script

Or create a simple loop:

```bash
#!/bin/bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/clickhouse

SNAPSHOT_DATE="2025-12-27"
SCAN_BASE="/project/cil/home_dirs/rcc/cil_scans"

DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

for DIR in "${DIRS[@]}"; do
    PARQUET_FILE="${SCAN_BASE}/${DIR}/${SNAPSHOT_DATE}/${DIR}_${SNAPSHOT_DATE}.parquet"

    if [ -f "${PARQUET_FILE}" ]; then
        echo "Importing ${DIR}..."
        python scripts/import_snapshot.py "${PARQUET_FILE}" "${SNAPSHOT_DATE}"
    else
        echo "WARNING: File not found: ${PARQUET_FILE}"
    fi
done

echo "All imports complete!"
```

Save as `import_all.sh` and run:
```bash
chmod +x import_all.sh
./import_all.sh
```

### Verify Import

```bash
# Check total entries imported
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT count() FROM filesystem.entries WHERE snapshot_date='2025-12-27'"

# Check entries by directory
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT
     substring(path, 1, 30) as dir,
     count() as files,
     sum(size) as total_size
   FROM filesystem.entries
   WHERE snapshot_date='2025-12-27'
   GROUP BY dir
   ORDER BY total_size DESC
   LIMIT 10
   FORMAT Pretty"
```

## Part 4: Compute Voronoi Hierarchy

The voronoi hierarchy enables fast visualization in the web interface.

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/clickhouse

python scripts/compute_voronoi_unified.py 2025-12-27 --root /project/cil
```

This will:
- Stream all entries from ClickHouse
- Build the complete directory hierarchy
- Store precomputed nodes in `voronoi_precomputed` table
- Take 5-15 minutes depending on file count

Expected output:
```
============================================================
Starting voronoi computation for 2025-12-27
============================================================
Found 42,488,746 rows to process
Executing streaming query...
Building hierarchy: 100%|████████| 42488746/42488746 [00:44<00:00, 956234rows/s]
Finalizing remaining nodes in stack...
============================================================
Computation complete!
Total rows processed: 42,488,746
Total nodes inserted: 8,234,521
============================================================
```

### Verify Voronoi Data

```bash
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT count() FROM filesystem.voronoi_precomputed WHERE snapshot_date='2025-12-27'"

# Check root nodes
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT node_id, name, path, depth, size
   FROM filesystem.voronoi_precomputed
   WHERE snapshot_date='2025-12-27' AND depth=0
   FORMAT Pretty"
```

## Part 5: Running the Web Interface

### Start Backend API

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/apps/api

# Create virtual environment (first time only)
python -m venv venv
source venv/bin/activate
pip install -e .

# Configure environment
cp .env.example .env
# Edit .env if needed (should work with defaults)

# Start API server
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Keep this running in one terminal.

### Start Frontend

Open a new terminal:

```bash
cd /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/apps/web

# Install dependencies (first time only)
npm install

# Start dev server
npm run dev
```

### Access the Application

Open your browser to:
- **Frontend**: http://localhost:3000
- **API docs**: http://localhost:8000/docs

## Part 6: Using the Interface

### View Snapshots
1. Navigate to the home page
2. Select snapshot date: `2025-12-27`

### Explore Directory Tree
1. Click on directories to expand
2. View file sizes and counts
3. Sort by size, name, or date

### Voronoi Treemap
1. Click "Voronoi View"
2. Interactive treemap shows size distribution
3. Click rectangles to drill down
4. Hover for details

### Search Files
1. Use search bar to find files
2. Filter by size, type, or date
3. Export results

## Troubleshooting

### Scan Issues

**Problem**: Jobs fail with "Scanner binary not found"
```bash
# Solution: Install scanner
cd scanner
cargo install --path .
```

**Problem**: "unrecognized subcommand 'aggregate'"
```bash
# Solution: Rebuild scanner
cd scanner
cargo uninstall storage-scanner
cargo build --release
cargo install --path .
```

### Import Issues

**Problem**: "Connection refused" when importing
```bash
# Solution: Check ClickHouse is running
docker ps | grep clickhouse
docker logs tracker-clickhouse
```

**Problem**: "File not found" during import
```bash
# Solution: Verify parquet files exist
ls -lh /project/cil/home_dirs/rcc/cil_scans/*/2025-12-27/*.parquet
```

### Voronoi Computation Issues

**Problem**: "No rows found"
```bash
# Solution: Check data was imported
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT count() FROM filesystem.entries WHERE snapshot_date='2025-12-27'"
```

**Problem**: Computation is very slow
```bash
# This is normal for 40M+ files. Takes 10-15 minutes.
# Run with --verbose to see progress
python scripts/compute_voronoi_unified.py 2025-12-27 --verbose
```

### Web Interface Issues

**Problem**: API returns empty data
```bash
# Check ClickHouse connection in API
curl http://localhost:8000/api/snapshots
```

**Problem**: Frontend won't start
```bash
# Clear Next.js cache
cd apps/web
rm -rf .next
npm run dev
```

## Appendix: Slurm Script Reference

### scan_cil_large.sh Configuration

Location: `scanner/scripts/scan_cil_large.sh`

Key parameters:
- **CPUs**: 32 per task
- **Memory**: 16 GB per task
- **Time**: 18 hours max
- **Array**: 0-6 (7 parallel jobs)

### Directories Scanned

The script scans these directories in parallel:
1. `battuta-shares-S3-archive` (array index 0)
2. `battuta_shares` (array index 1)
3. `gcp` (array index 2)
4. `home_dirs` (array index 3)
5. `kupe_shares` (array index 4)
6. `norgay` (array index 5)
7. `sacagawea_shares` (array index 6)

### Output Locations

- **Parquet files**: `/project/cil/home_dirs/rcc/cil_scans/{DIR}/{DATE}/{DIR}_{DATE}.parquet`
- **Manifests**: `/project/cil/home_dirs/rcc/cil_scans/{DIR}/{DATE}/{DIR}_{DATE}_manifest.json`
- **Logs**: `/project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_{0-6}.{out,err}`

## Summary Workflow

```
1. Scan Filesystem (Slurm)
   └─> 7 Parquet files (one per directory)

2. Initialize ClickHouse
   └─> Create tables and views

3. Import All Parquets
   └─> Single database with all entries for 2025-12-27

4. Compute Voronoi
   └─> Precomputed hierarchy for visualization

5. Start Web Interface
   └─> Explore and analyze storage
```

## Next Steps

- Schedule regular scans (weekly/monthly)
- Compare snapshots over time
- Identify storage growth areas
- Generate cleanup reports
- Set up automated imports
