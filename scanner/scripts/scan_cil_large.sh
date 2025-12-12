#!/bin/bash
#SBATCH --job-name=cil_scan_large
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=16
#SBATCH --ntasks=1
#SBATCH --mem-per-cpu=4G
#SBATCH --time=48:00:00
#SBATCH --array=0-6
#SBATCH -o ./slurm_out/scan_large_%a.out
#SBATCH -e ./slurm_out/scan_large_%a.err

################################################################################
# Optimized Scanner for Large /project/cil directories
#
# Use this for very large directories (>1TB, >1M files)
# - More threads (16 instead of 8)
# - Larger chunks (1M rows instead of 500K)
# - Longer time limit (48h instead of 24h)
#
# Usage:
#   mkdir -p slurm_out
#   sbatch scanner/scripts/scan_cil_large.sh
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

# Configuration
BASE_PATH="/project/cil"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
DATE=$(date +%Y-%m-%d)
SCANNER_BIN="./scanner/target/release/storage-scanner"

# Get directory for this array task
DIR=${DIRS[$SLURM_ARRAY_TASK_ID]}

echo "================================================"
echo "CIL Storage Scanner - LARGE Directory Mode"
echo "================================================"
echo "Array Task ID: ${SLURM_ARRAY_TASK_ID} / ${#DIRS[@]}"
echo "Directory: ${DIR}"
echo "Full Path: ${BASE_PATH}/${DIR}"
echo "Output Dir: ${OUTPUT_DIR}"
echo "Node: $(hostname)"
echo "CPUs: ${SLURM_CPUS_PER_TASK}"
echo "Memory: $((${SLURM_CPUS_PER_TASK} * ${SLURM_MEM_PER_CPU}))MB total"
echo "Time Limit: 48 hours"
echo "Start Time: $(date)"
echo "================================================"
echo ""

# Verify scanner binary
if [ ! -f "${SCANNER_BIN}" ]; then
    echo "ERROR: Scanner binary not found at ${SCANNER_BIN}"
    exit 1
fi

# Create output directory
mkdir -p ${OUTPUT_DIR}

# Run scanner with optimized parameters for large directories
echo "Starting optimized scan for large directory..."
${SCANNER_BIN} scan \
    --path "${BASE_PATH}/${DIR}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads ${SLURM_CPUS_PER_TASK} \
    --batch-size 100000 \
    --incremental \
    --rows-per-chunk 1000000 \
    --chunk-interval-secs 600 \
    --resume \
    --verbose

EXIT_CODE=$?

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
    echo "✓ Scan completed successfully"
    echo ""
    echo "Output Summary:"
    CHUNK_COUNT=$(ls ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet 2>/dev/null | wc -l)
    echo "  Chunks: ${CHUNK_COUNT}"
    du -sh ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet 2>/dev/null | tail -1 | awk '{print "  Total Size: " $1}'

    # Parse manifest for detailed stats
    if [ -f "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" ]; then
        echo ""
        echo "Detailed Statistics:"
        TOTAL_ROWS=$(grep '"total_rows"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | awk '{print $2}' | tr -d ',')
        echo "  Total Rows: $(printf "%'d" ${TOTAL_ROWS} 2>/dev/null || echo ${TOTAL_ROWS})"
        grep '"scan_start"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | sed 's/^/  /'
        grep '"scan_end"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | sed 's/^/  /'
    fi
else
    echo "✗ Scan failed with exit code ${EXIT_CODE}"
fi

echo "================================================"

exit ${EXIT_CODE}
