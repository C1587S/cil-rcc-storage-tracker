#!/bin/bash
#SBATCH --job-name=cil_scan_large
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=16G
#SBATCH --time=18:00:00
#SBATCH --array=0-6
#SBATCH -o /project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_%a.out
#SBATCH -e /project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_%a.err

### Total time with this config is 30 minutes to scan /project/cil fully
################################################################################
#
# This script performs a two-step process:
#   1. Scan: Uses incremental mode to generate chunk files during scanning
#   2. Aggregate: Combines all chunks into a single Parquet file and deletes chunks
#
# Prerequisites:
#   - Rebuild scanner if you see "unrecognized subcommand 'aggregate'" error:
#       cd scanner && cargo build --release && cargo install --path .
#
# Usage:
#   mkdir -p /project/cil/home_dirs/rcc/cil_scans/slurm_out
#   sbatch scanner/scripts/scan_cil_large.sh
#
# Output:
#   - Final aggregated file: {OUTPUT_DIR}/{DIR}_{DATE}.parquet
#   - Manifest file: {OUTPUT_DIR}/{DIR}_{DATE}_manifest.json
#   - Chunk files are automatically deleted after aggregation
################################################################################

# Define directories to scan
DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

module load python
source activate /project/cil/home_dirs/rcc/envs/storage_scanner 


# Configuration
BASE_PATH="/project/cil"
DATE=$(date +%Y-%m-%d)
# Scanner binary location
# If installed globally, it should be available in PATH
SCANNER_BIN="storage-scanner"
# Get directory for this array task
DIR=${DIRS[$SLURM_ARRAY_TASK_ID]}
OUTPUT_DIR="/project/cil/home_dirs/rcc/cil_scans/${DIR}/${DATE}"

echo "================================================"
echo "CIL Storage Scanner - LARGE Directory Mode"
echo "================================================"
echo "Array Task ID: ${SLURM_ARRAY_TASK_ID} / ${#DIRS[@]}"
echo "Directory: ${DIR}"
echo "Full Path: ${BASE_PATH}/${DIR}"
echo "Output Dir: ${OUTPUT_DIR}"
echo "Node: $(hostname)"
echo "CPUs: ${SLURM_CPUS_PER_TASK}"
echo "Memory requested: 16 GB"
echo "Time Limit: 48 hours"
echo "Start Time: $(date)"
echo "================================================"
echo ""

# Verify scanner binary
if ! command -v ${SCANNER_BIN} >/dev/null 2>&1; then
    echo "ERROR: Scanner binary not found in PATH"
    exit 1
fi

# Create output directory
mkdir -p ${OUTPUT_DIR}

# Run scanner with optimized parameters for large directories
echo "Starting optimized scan for large directory..."
/usr/bin/time -v ${SCANNER_BIN} scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads ${SLURM_CPUS_PER_TASK} \
    --batch-size 200000 \
    --incremental \
    --rows-per-chunk 1000000 \
    --chunk-interval-secs 600 \
    --resume \
    --verbose

SCAN_EXIT_CODE=$?

echo ""
echo "================================================"
echo "Scan completed with exit code: ${SCAN_EXIT_CODE}"
echo "================================================"
echo ""

# Aggregate chunks into single Parquet file
if [ ${SCAN_EXIT_CODE} -eq 0 ]; then
    # Check if scanner supports aggregate command
    if ${SCANNER_BIN} --help 2>&1 | grep -q "aggregate"; then
        echo "Starting aggregation of chunk files..."
        /usr/bin/time -v ${SCANNER_BIN} aggregate \
            --input "${OUTPUT_DIR}" \
            --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
            --delete-chunks

        EXIT_CODE=$?

        if [ ${EXIT_CODE} -eq 0 ]; then
            echo "Aggregation completed successfully"
        else
            echo "Aggregation failed with exit code ${EXIT_CODE}"
        fi
    else
        echo "WARNING: Scanner binary does not support 'aggregate' command"
        echo "Please rebuild the scanner:"
        echo "  cd scanner && cargo build --release"
        echo ""
        echo "Chunk files are located at: ${OUTPUT_DIR}"
        echo "You will need to manually aggregate them later."
        EXIT_CODE=0  # Don't fail the job, scan succeeded
    fi
else
    echo "Skipping aggregation due to scan failure"
    EXIT_CODE=${SCAN_EXIT_CODE}
fi

    
echo ""
echo "================================================"
echo "Scan Summary"
echo "================================================"
echo "Directory: ${DIR}"
echo "Exit Code: ${EXIT_CODE}"
echo "Duration: $(($(date +%s) - $(date -d "$(head -1 slurm_out/scan_large_${SLURM_ARRAY_TASK_ID}.out | awk '{print $NF}')" +%s 2>/dev/null || echo 0))) seconds"
echo "End Time: $(date)"
echo ""

if [ ${EXIT_CODE} -eq 0 ]; then
    echo "✓ Scan and aggregation completed successfully"
    echo ""
    echo "Output Summary:"

    # Check for aggregated file
    if [ -f "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" ]; then
        AGGREGATED_SIZE=$(du -sh "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" | awk '{print $1}')
        echo "  Aggregated File: ${DIR}_${DATE}.parquet"
        echo "  Size: ${AGGREGATED_SIZE}"
    fi

    # Parse manifest for detailed stats
    if [ -f "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" ]; then
        echo ""
        echo "Scan Statistics:"
        TOTAL_ROWS=$(grep '"total_rows"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | awk '{print $2}' | tr -d ',')
        echo "  Total Rows: $(printf "%'d" ${TOTAL_ROWS} 2>/dev/null || echo ${TOTAL_ROWS})"
        grep '"scan_start"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | sed 's/^/  /'
        grep '"scan_end"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | sed 's/^/  /'
    fi

    # Show remaining files
    REMAINING_FILES=$(ls ${OUTPUT_DIR} 2>/dev/null | wc -l)
    echo ""
    echo "  Files in output directory: ${REMAINING_FILES}"
else
    echo "✗ Scan or aggregation failed with exit code ${EXIT_CODE}"
    echo ""
    echo "Check logs for details:"
    echo "  Output: /project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_${SLURM_ARRAY_TASK_ID}.out"
    echo "  Error:  /project/cil/home_dirs/rcc/cil_scans/slurm_out/scan_large_${SLURM_ARRAY_TASK_ID}.err"
fi

echo "================================================"

exit ${EXIT_CODE}
