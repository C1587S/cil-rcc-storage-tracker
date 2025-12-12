#!/bin/bash
#SBATCH --job-name=cil_scan
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=32G
#SBATCH --time=24:00:00
#SBATCH --array=0-6
#SBATCH -o slurm_logs/scan_%a.out
#SBATCH -e slurm_logs/scan_%a.err

################################################################################
# CIL Storage Scanner - Parallel Directory Scanning
#
# This script scans all major directories in /project/cil in parallel using
# Slurm job arrays. Each directory is scanned independently with incremental
# output and resume capability.
#
# Usage:
#   1. Edit configuration variables below (BASE_PATH, OUTPUT_BASE, etc.)
#   2. Create log directory: mkdir -p slurm_logs
#   3. Submit job: sbatch rcc-workflows/scripts/01_scan_cil.sh
#
# Output:
#   - Parquet chunk files in: ${OUTPUT_BASE}/${DIR}/${DATE}/
#   - Manifest file for resume capability
#   - Logs in: slurm_logs/
################################################################################

# ============================================================================
# CONFIGURATION - Edit these variables for your environment
# ============================================================================

# Directories to scan (must match array size in #SBATCH --array)
DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

# Base path to scan
BASE_PATH="/project/cil"

# Base output directory for scan results
OUTPUT_BASE="/scratch/midway3/${USER}/cil_scans"

# Scanner binary (if installed in conda env, should be in PATH)
SCANNER_BIN="storage-scanner"

# Scan date (YYYY-MM-DD format)
DATE=$(date +%Y-%m-%d)

# ============================================================================
# ENVIRONMENT SETUP
# ============================================================================

# Load required modules
module load python

# Activate conda environment with scanner installed
source activate /project/cil/home_dirs/rcc/envs/storage_scanner

# ============================================================================
# JOB EXECUTION
# ============================================================================

# Get directory for this array task
DIR=${DIRS[$SLURM_ARRAY_TASK_ID]}
OUTPUT_DIR="${OUTPUT_BASE}/${DIR}/${DATE}"

echo "========================================================================"
echo "CIL Storage Scanner - Scan Job"
echo "========================================================================"
echo "Job Information:"
echo "  Array Task ID:  ${SLURM_ARRAY_TASK_ID} / ${#DIRS[@]}"
echo "  Directory:      ${DIR}"
echo "  Full Path:      ${BASE_PATH}/${DIR}"
echo "  Output Dir:     ${OUTPUT_DIR}"
echo "  Node:           $(hostname)"
echo "  CPUs:           ${SLURM_CPUS_PER_TASK}"
echo "  Memory:         32 GB"
echo "  Time Limit:     24 hours"
echo "  Start Time:     $(date)"
echo "========================================================================"
echo ""

# Verify scanner binary exists
if ! command -v ${SCANNER_BIN} >/dev/null 2>&1; then
    echo "ERROR: Scanner binary '${SCANNER_BIN}' not found in PATH"
    echo "Please ensure the scanner is installed in your conda environment"
    exit 1
fi

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Run scanner with incremental mode and resume capability
echo "Starting scan (incremental mode enabled)..."
echo ""

/usr/bin/time -v ${SCANNER_BIN} scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads ${SLURM_CPUS_PER_TASK} \
    --batch-size 100000 \
    --incremental \
    --rows-per-chunk 500000 \
    --chunk-interval-secs 600 \
    --resume \
    --verbose

EXIT_CODE=$?

# ============================================================================
# SUMMARY AND REPORTING
# ============================================================================

echo ""
echo "========================================================================"
echo "Scan Summary"
echo "========================================================================"
echo "Directory:  ${DIR}"
echo "Exit Code:  ${EXIT_CODE}"
echo "End Time:   $(date)"
echo ""

if [ ${EXIT_CODE} -eq 0 ]; then
    echo "Status: ✓ Scan completed successfully"
    echo ""

    # Count chunk files
    CHUNK_COUNT=$(ls ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet 2>/dev/null | wc -l)
    echo "Output Summary:"
    echo "  Chunk files:  ${CHUNK_COUNT}"

    # Show total size
    if [ ${CHUNK_COUNT} -gt 0 ]; then
        TOTAL_SIZE=$(du -sh ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet 2>/dev/null | tail -1 | awk '{print $1}')
        echo "  Total size:   ${TOTAL_SIZE}"
    fi

    # Parse manifest for detailed stats
    MANIFEST="${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json"
    if [ -f "${MANIFEST}" ]; then
        echo ""
        echo "Scan Statistics:"
        TOTAL_ROWS=$(grep '"total_rows"' "${MANIFEST}" | awk '{print $2}' | tr -d ',')
        [ -n "${TOTAL_ROWS}" ] && echo "  Total rows:   ${TOTAL_ROWS}"
    fi

    echo ""
    echo "Next Steps:"
    echo "  1. Wait for all array jobs to complete"
    echo "  2. Run aggregation: sbatch rcc-workflows/scripts/02_aggregate_chunks.sh"
else
    echo "Status: ✗ Scan failed with exit code ${EXIT_CODE}"
    echo ""
    echo "Troubleshooting:"
    echo "  - Check error log: slurm_logs/scan_${SLURM_ARRAY_TASK_ID}.err"
    echo "  - To resume: sbatch --array=${SLURM_ARRAY_TASK_ID} rcc-workflows/scripts/01_scan_cil.sh"
fi

echo "========================================================================"

exit ${EXIT_CODE}
