#!/bin/bash
#SBATCH --job-name=cil_aggregate
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=02:00:00
#SBATCH --array=0-6
#SBATCH -o slurm_logs/aggregate_%a.out
#SBATCH -e slurm_logs/aggregate_%a.err

################################################################################
# CIL Storage Aggregation - Consolidate Parquet Chunks
#
# This script aggregates the parquet chunk files created by the scanner into
# single consolidated files, one per directory. It also optionally deletes the
# intermediate chunk files to save space.
#
# Usage:
#   1. Ensure scan jobs have completed successfully
#   2. Edit configuration variables below (must match scan script)
#   3. Submit job: sbatch rcc-workflows/scripts/02_aggregate_chunks.sh
#
# Output:
#   - Aggregated parquet file in: ${OUTPUT_BASE}_aggregated/${DATE}/
#   - Logs in: slurm_logs/
################################################################################

# ============================================================================
# CONFIGURATION - Must match 01_scan_cil.sh
# ============================================================================

# Directories (must match scan script)
DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

# Scan output base directory (where chunks are located)
SCAN_OUTPUT_BASE="/scratch/midway3/${USER}/cil_scans"

# Aggregated output directory
AGGREGATED_OUTPUT_BASE="/scratch/midway3/${USER}/cil_scans_aggregated"

# Scanner binary
SCANNER_BIN="storage-scanner"

# Scan date (must match the date used in scan)
DATE=$(date +%Y-%m-%d)

# Delete chunk files after successful aggregation? (true/false)
DELETE_CHUNKS=true

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
CHUNK_DIR="${SCAN_OUTPUT_BASE}/${DIR}/${DATE}"
OUTPUT_DIR="${AGGREGATED_OUTPUT_BASE}/${DATE}"
OUTPUT_FILE="${OUTPUT_DIR}/${DIR}.parquet"

echo "========================================================================"
echo "CIL Storage Aggregation"
echo "========================================================================"
echo "Job Information:"
echo "  Array Task ID:    ${SLURM_ARRAY_TASK_ID} / ${#DIRS[@]}"
echo "  Directory:        ${DIR}"
echo "  Chunk directory:  ${CHUNK_DIR}"
echo "  Output file:      ${OUTPUT_FILE}"
echo "  Delete chunks:    ${DELETE_CHUNKS}"
echo "  Node:             $(hostname)"
echo "  Start Time:       $(date)"
echo "========================================================================"
echo ""

# Verify scanner binary exists
if ! command -v ${SCANNER_BIN} >/dev/null 2>&1; then
    echo "ERROR: Scanner binary '${SCANNER_BIN}' not found in PATH"
    exit 1
fi

# Verify chunk directory exists
if [ ! -d "${CHUNK_DIR}" ]; then
    echo "ERROR: Chunk directory not found: ${CHUNK_DIR}"
    echo "Please ensure scan job completed successfully"
    exit 1
fi

# Count chunk files
CHUNK_COUNT=$(ls ${CHUNK_DIR}/*_chunk_*.parquet 2>/dev/null | wc -l)
if [ ${CHUNK_COUNT} -eq 0 ]; then
    echo "ERROR: No chunk files found in ${CHUNK_DIR}"
    exit 1
fi

echo "Found ${CHUNK_COUNT} chunk file(s) to aggregate"
echo ""

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Run aggregation
echo "Starting aggregation..."
echo ""

if [ "${DELETE_CHUNKS}" = "true" ]; then
    ${SCANNER_BIN} aggregate \
        --input "${CHUNK_DIR}" \
        --output "${OUTPUT_FILE}" \
        --delete-chunks \
        --verbose
else
    ${SCANNER_BIN} aggregate \
        --input "${CHUNK_DIR}" \
        --output "${OUTPUT_FILE}" \
        --verbose
fi

EXIT_CODE=$?

# ============================================================================
# SUMMARY AND REPORTING
# ============================================================================

echo ""
echo "========================================================================"
echo "Aggregation Summary"
echo "========================================================================"
echo "Directory:  ${DIR}"
echo "Exit Code:  ${EXIT_CODE}"
echo "End Time:   $(date)"
echo ""

if [ ${EXIT_CODE} -eq 0 ]; then
    echo "Status: ✓ Aggregation completed successfully"
    echo ""

    # Show output file info
    if [ -f "${OUTPUT_FILE}" ]; then
        FILE_SIZE=$(du -h "${OUTPUT_FILE}" | awk '{print $1}')
        echo "Output Summary:"
        echo "  File:        ${OUTPUT_FILE}"
        echo "  Size:        ${FILE_SIZE}"

        # Verify chunks were deleted if requested
        if [ "${DELETE_CHUNKS}" = "true" ]; then
            REMAINING=$(ls ${CHUNK_DIR}/*_chunk_*.parquet 2>/dev/null | wc -l)
            if [ ${REMAINING} -eq 0 ]; then
                echo "  Chunks:      Deleted successfully"
            else
                echo "  Chunks:      WARNING - ${REMAINING} chunks remain"
            fi
        fi
    fi

    echo ""
    echo "Next Steps:"
    echo "  1. Wait for all aggregation jobs to complete"
    echo "  2. Copy aggregated files to local machine:"
    echo "     scp -r ${USER}@midway3.rcc.uchicago.edu:${AGGREGATED_OUTPUT_BASE}/${DATE} ./"
    echo "  3. Import to backend (see rcc-workflows/README.md)"
else
    echo "Status: ✗ Aggregation failed with exit code ${EXIT_CODE}"
    echo ""
    echo "Troubleshooting:"
    echo "  - Check error log: slurm_logs/aggregate_${SLURM_ARRAY_TASK_ID}.err"
    echo "  - Verify chunk files exist: ls ${CHUNK_DIR}/*_chunk_*.parquet"
fi

echo "========================================================================"

exit ${EXIT_CODE}
