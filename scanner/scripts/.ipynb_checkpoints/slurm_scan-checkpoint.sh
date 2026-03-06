#!/bin/bash
#SBATCH --job-name=storage-scan
#SBATCH --array=0-7
#SBATCH --cpus-per-task=16
#SBATCH --mem=8G
#SBATCH --time=4:00:00
#SBATCH --output=logs/scan_%A_%a.out
#SBATCH --error=logs/scan_%A_%a.err

# Slurm job array script for parallel storage scanning
# This script scans multiple top-level directories in parallel using Slurm job arrays

set -e

# Configuration
SCANNER_BIN="${SCANNER_BIN:-./target/release/storage-scanner}"
SNAPSHOT_DATE=$(date +%Y-%m-%d)
SNAPSHOT_DIR="${SNAPSHOT_DIR:-/snapshots/$SNAPSHOT_DATE}"
LOG_DIR="${LOG_DIR:-./logs}"

# Directory list to scan
DIRS=(
    "cil"
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

# Create output and log directories
mkdir -p "$SNAPSHOT_DIR"
mkdir -p "$LOG_DIR"

# Get directory for this array task
DIR_INDEX=$SLURM_ARRAY_TASK_ID
DIR_NAME="${DIRS[$DIR_INDEX]}"
SCAN_PATH="/project/${DIR_NAME}"
OUTPUT_FILE="$SNAPSHOT_DIR/${DIR_NAME}.parquet"
LOG_FILE="$LOG_DIR/scan_${DIR_NAME}_${SLURM_JOB_ID}.log"

echo "========================================" | tee -a "$LOG_FILE"
echo "Storage Scanner - Slurm Job Array" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Job ID:        $SLURM_JOB_ID" | tee -a "$LOG_FILE"
echo "Array Task ID: $SLURM_ARRAY_TASK_ID" | tee -a "$LOG_FILE"
echo "Node:          $HOSTNAME" | tee -a "$LOG_FILE"
echo "CPUs:          $SLURM_CPUS_PER_TASK" | tee -a "$LOG_FILE"
echo "Directory:     $DIR_NAME" | tee -a "$LOG_FILE"
echo "Scan path:     $SCAN_PATH" | tee -a "$LOG_FILE"
echo "Output file:   $OUTPUT_FILE" | tee -a "$LOG_FILE"
echo "Start time:    $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check if scanner binary exists
if [ ! -f "$SCANNER_BIN" ]; then
    echo "Error: Scanner binary not found at $SCANNER_BIN" | tee -a "$LOG_FILE"
    echo "Please build the scanner first with: cargo build --release" | tee -a "$LOG_FILE"
    exit 1
fi

# Check if scan path exists
if [ ! -d "$SCAN_PATH" ]; then
    echo "Error: Scan path does not exist: $SCAN_PATH" | tee -a "$LOG_FILE"
    exit 1
fi

# Run the scanner
echo "Starting scan..." | tee -a "$LOG_FILE"

"$SCANNER_BIN" scan \
    --path "$SCAN_PATH" \
    --output "$OUTPUT_FILE" \
    --threads "$SLURM_CPUS_PER_TASK" \
    --batch-size 100000 \
    --verbose 2>&1 | tee -a "$LOG_FILE"

SCANNER_EXIT_CODE=$?

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Scan completed with exit code: $SCANNER_EXIT_CODE" | tee -a "$LOG_FILE"
echo "End time: $(date)" | tee -a "$LOG_FILE"

if [ $SCANNER_EXIT_CODE -eq 0 ]; then
    echo "Status: SUCCESS" | tee -a "$LOG_FILE"

    # Print output file info
    if [ -f "$OUTPUT_FILE" ]; then
        OUTPUT_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
        echo "Output file size: $OUTPUT_SIZE" | tee -a "$LOG_FILE"
    fi
else
    echo "Status: FAILED" | tee -a "$LOG_FILE"
fi

echo "========================================" | tee -a "$LOG_FILE"

exit $SCANNER_EXIT_CODE
