# RCC Workflow Guide

Complete guide for scanning, aggregating, and analyzing filesystem data on the UChicago RCC cluster.

## Overview

This workflow consists of three main stages:

1. **Scan** - Run parallel filesystem scans on RCC using Slurm job arrays
2. **Aggregate** - Consolidate chunk files into single Parquet files
3. **Import** - Transfer and import data to the backend for analysis

## Prerequisites

### On RCC Cluster

- Access to UChicago RCC cluster (Midway3)
- Scanner installed in conda environment
- Slurm job submission access
- Sufficient quota in `/scratch/midway3/$USER/`

### On Local Machine

- This repository cloned
- Backend environment set up (Python 3.10+, dependencies installed)
- Sufficient disk space for snapshot data

## Complete Workflow

### Stage 1: Scan Filesystem on RCC

#### 1.1 Prepare Environment

```bash
# SSH to RCC
ssh username@midway3.rcc.uchicago.edu

# Navigate to project directory
cd /project/cil/home_dirs/username/projects/cil-rcc-storage-tracker

# Create log directory
mkdir -p rcc-workflows/scripts/slurm_logs
```

#### 1.2 Configure Scan Script

Edit `rcc-workflows/scripts/01_scan_cil.sh` and update these variables:

```bash
# Directories to scan (adjust as needed)
DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

# Base output directory (use scratch for large datasets)
OUTPUT_BASE="/scratch/midway3/${USER}/cil_scans"
```

**Important**: Ensure the `--array` parameter in the script header matches the number of directories:
```bash
#SBATCH --array=0-6  # For 7 directories (0-indexed)
```

#### 1.3 Submit Scan Job

```bash
# Submit job array (one job per directory)
sbatch rcc-workflows/scripts/01_scan_cil.sh

# Check job status
squeue -u $USER

# Monitor progress (watch live output from first job)
tail -f rcc-workflows/scripts/slurm_logs/scan_0.out
```

#### 1.4 Monitor Scan Progress

Each job will output to `slurm_logs/scan_X.out` where X is the array index.

To check all jobs:
```bash
# Check which jobs are still running
squeue -u $USER | grep cil_scan

# Check completion status
ls rcc-workflows/scripts/slurm_logs/scan_*.out | xargs grep "Scan completed"

# Check for errors
ls rcc-workflows/scripts/slurm_logs/scan_*.err | xargs grep -i error
```

#### 1.5 Resume Failed Jobs (if needed)

If a job fails or times out, resubmit just that array index:

```bash
# Resume job 3 (for example)
sbatch --array=3 rcc-workflows/scripts/01_scan_cil.sh

# Resume multiple jobs
sbatch --array=2,5,6 rcc-workflows/scripts/01_scan_cil.sh
```

The `--resume` flag in the scan command will automatically skip completed directories.

### Stage 2: Aggregate Chunks on RCC

After all scan jobs complete, consolidate the chunk files.

#### 2.1 Configure Aggregation Script

Edit `rcc-workflows/scripts/02_aggregate_chunks.sh` and ensure these match the scan script:

```bash
# Must match scan script
DIRS=(...)
SCAN_OUTPUT_BASE="/scratch/midway3/${USER}/cil_scans"

# Output location for aggregated files
AGGREGATED_OUTPUT_BASE="/scratch/midway3/${USER}/cil_scans_aggregated"

# Delete chunk files after aggregation? (saves space)
DELETE_CHUNKS=true
```

#### 2.2 Submit Aggregation Job

```bash
# Submit aggregation job array
sbatch rcc-workflows/scripts/02_aggregate_chunks.sh

# Monitor progress
tail -f rcc-workflows/scripts/slurm_logs/aggregate_0.out

# Check all aggregation jobs
ls rcc-workflows/scripts/slurm_logs/aggregate_*.out | xargs grep "Aggregation completed"
```

#### 2.3 Verify Aggregated Files

```bash
# Check aggregated output
DATE=$(date +%Y-%m-%d)
ls -lh /scratch/midway3/$USER/cil_scans_aggregated/${DATE}/

# Expected files (one per directory):
# battuta-shares-S3-archive.parquet
# battuta_shares.parquet
# gcp.parquet
# home_dirs.parquet
# kupe_shares.parquet
# norgay.parquet
# sacagawea_shares.parquet

# Check file sizes
du -sh /scratch/midway3/$USER/cil_scans_aggregated/${DATE}/*.parquet
```

### Stage 3: Import to Backend

#### 3.1 Copy Data to Local Machine

From your local machine:

```bash
# Copy aggregated files from RCC to local
DATE=$(date +%Y-%m-%d)
scp -r username@midway3.rcc.uchicago.edu:/scratch/midway3/username/cil_scans_aggregated/${DATE} ./

# This will download all aggregated parquet files to ./${DATE}/
```

#### 3.2 Import to Backend

```bash
# Navigate to backend directory
cd backend

# Activate virtual environment
source venv/bin/activate

# Import the snapshot
DATE=$(date +%Y-%m-%d)
python scripts/import_snapshot.py ../${DATE} ${DATE}

# The script will:
# - Validate all parquet files
# - Copy them to backend/data/snapshots/${DATE}/
# - Verify row counts
```

#### 3.3 Verify Import

```bash
# Check backend data directory
ls -lh backend/data/snapshots/${DATE}/

# Start backend to verify data
cd backend
uvicorn app.main:app --reload

# In another terminal, test API
curl http://localhost:8000/api/snapshots
```

#### 3.4 Start Frontend

```bash
# In a new terminal
cd frontend
npm run dev

# Open browser to: http://localhost:3001/dashboard/${DATE}
```

## Typical Timeline

For scanning all /project/cil directories (estimated):

| Stage | Duration | Notes |
|-------|----------|-------|
| Scan (parallel) | 2-4 hours | 7 jobs running simultaneously |
| Aggregation (parallel) | 15-30 minutes | 7 jobs running simultaneously |
| Data transfer | 30-60 minutes | Depends on network speed |
| Import to backend | 5-10 minutes | Local processing |

**Total time**: Approximately 3-5 hours from start to finish

## Resource Requirements

### RCC Cluster

**Per scan job:**
- CPUs: 16
- Memory: 32 GB
- Time: 24 hours (max, usually much less)
- Scratch space: ~50-100 GB per directory

**Per aggregation job:**
- CPUs: 4
- Memory: 16 GB
- Time: 2 hours (max)

### Local Machine

- Disk space: ~500 GB - 1 TB for full CIL snapshot
- Backend: 4 GB RAM minimum
- Frontend: 2 GB RAM minimum

## Troubleshooting

### Scan Job Fails

```bash
# Check error log
cat rcc-workflows/scripts/slurm_logs/scan_X.err

# Common issues:
# - Out of memory: Increase --mem in script
# - Timeout: Increase --time in script
# - Permission denied: Check access to scan directory
# - Scanner not found: Verify conda environment

# Resume the failed job
sbatch --array=X rcc-workflows/scripts/01_scan_cil.sh
```

### Aggregation Fails

```bash
# Check error log
cat rcc-workflows/scripts/slurm_logs/aggregate_X.err

# Verify chunk files exist
ls /scratch/midway3/$USER/cil_scans/DIRNAME/${DATE}/*_chunk_*.parquet

# Rerun aggregation for specific directory
sbatch --array=X rcc-workflows/scripts/02_aggregate_chunks.sh
```

### Import Fails

```bash
# Check parquet file validity
python -c "import polars as pl; df = pl.read_parquet('./${DATE}/FILENAME.parquet'); print(df.shape)"

# Verify date format
echo ${DATE}  # Should be YYYY-MM-DD

# Check disk space
df -h backend/data/
```

## Cost Optimization

### Scan Stage

- Use `--incremental` and `--resume`: Allows resuming interrupted scans
- Adjust `--rows-per-chunk`: Larger chunks = fewer files, but less granular resume
- Use scratch space: `/scratch/midway3/$USER` has more quota than `/project`

### Aggregation Stage

- Set `DELETE_CHUNKS=true`: Saves ~50% disk space
- Run immediately after scans: Reduces scratch space usage

### Storage

- Delete raw scan chunks after successful aggregation
- Compress old snapshots if keeping historical data
- Use selective imports (only needed directories)

## Advanced Usage

### Scan Specific Directories Only

Edit the scan script to include only desired directories:

```bash
DIRS=(
    "gcp"
    "home_dirs"
)

# Update array size: --array=0-1
```

### Custom Scan Parameters

For very large directories, adjust these parameters in the scan script:

```bash
--threads 32              # More threads for faster scanning
--rows-per-chunk 1000000  # Larger chunks for fewer files
--batch-size 200000       # Larger batches for better performance
```

### Dry Run (Test Mode)

To test without actually scanning:

```bash
# Edit scan script, add --max-depth 1 to limit scan depth
storage-scanner scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/test.parquet" \
    --max-depth 1 \
    --verbose
```

## Automation

### Scheduled Scans

Create a cron job on RCC to run scans automatically:

```bash
# Add to crontab
0 2 1 * * cd /project/cil/home_dirs/username/projects/cil-rcc-storage-tracker && sbatch rcc-workflows/scripts/01_scan_cil.sh
```

This runs on the 1st of each month at 2 AM.

### Notification on Completion

Add email notification to Slurm scripts:

```bash
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=your.email@uchicago.edu
```

## Best Practices

1. **Always use scratch space** for intermediate files (`/scratch/midway3/$USER`)
2. **Test with one directory first** before submitting full job array
3. **Monitor quota usage**: `quota` command on RCC
4. **Keep aggregated files** until backend import is verified
5. **Document scan dates** in a log file
6. **Verify data integrity** at each stage
7. **Clean up old scans** regularly to free space

## Support

For issues or questions:

1. Check logs in `slurm_logs/`
2. Review troubleshooting section above
3. Check scanner README: [scanner/README.md](../scanner/README.md)
4. Check backend README: [backend/README.md](../backend/README.md)

---

Last Updated: 2025-12-12
