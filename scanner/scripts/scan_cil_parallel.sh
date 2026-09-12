#!/bin/bash
#SBATCH --job-name=cil_scan
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=8
#SBATCH --ntasks=1
#SBATCH --mem-per-cpu=4G
#SBATCH --time=24:00:00
#SBATCH --array=0-8
#SBATCH -o ./slurm_out/scan_%a.out
#SBATCH -e ./slurm_out/scan_%a.err

################################################################################
# Parallel Scanner for CIL storage
#
# Scans each storage area in parallel using Slurm job arrays.
# Each target gets its own job for maximum parallelism.
# Covers /project/cil (Capacity tier) and /cds3/cil (Cost-Effective tier).
#
# Usage:
#   1. mkdir -p slurm_out
#   2. sbatch scanner/scripts/scan_cil_parallel.sh
#
# To resume failed jobs:
#   sbatch scanner/scripts/scan_cil_parallel.sh
#   # Or specific jobs: sbatch --array=2,5 scanner/scripts/scan_cil_parallel.sh
################################################################################

# Scan targets (must match --array=0-8 above).
# NAMES[i] becomes the output file prefix; PATHS[i] is the directory scanned.
NAMES=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
    "cds3"
    "coastal"
)
PATHS=(
    "/project/cil/battuta-shares-S3-archive"
    "/project/cil/battuta_shares"
    "/project/cil/gcp"
    "/project/cil/home_dirs"
    "/project/cil/kupe_shares"
    "/project/cil/norgay"
    "/project/cil/sacagawea_shares"
    "/cds3/cil"
    "/project/cil/coastal"
)

# Configuration
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
DATE=$(date +%Y-%m-%d)
SCANNER_BIN="./scanner/target/release/storage-scanner"

# Get target for this array task
DIR=${NAMES[$SLURM_ARRAY_TASK_ID]}
SCAN_PATH=${PATHS[$SLURM_ARRAY_TASK_ID]}

echo "================================================"
echo "CIL Storage Scanner - Parallel Scan"
echo "================================================"
echo "Array Task ID: ${SLURM_ARRAY_TASK_ID} / ${#NAMES[@]}"
echo "Target: ${DIR}"
echo "Full Path: ${SCAN_PATH}"
echo "Output Dir: ${OUTPUT_DIR}"
echo "Node: $(hostname)"
echo "CPUs: ${SLURM_CPUS_PER_TASK}"
echo "Memory: ${SLURM_MEM_PER_CPU}MB per CPU"
echo "Start Time: $(date)"
echo "================================================"
echo ""

# Verify scanner binary exists
if [ ! -f "${SCANNER_BIN}" ]; then
    echo "ERROR: Scanner binary not found at ${SCANNER_BIN}"
    echo "Please build it first: cd scanner && cargo build --release && cd .."
    exit 1
fi

# Create output directory
mkdir -p ${OUTPUT_DIR}

# Run scanner with resume capability
echo "Starting scan..."
${SCANNER_BIN} scan \
    --path "${SCAN_PATH}" \
    --output "${OUTPUT_DIR}/${DIR}_${DATE}.parquet" \
    --threads ${SLURM_CPUS_PER_TASK} \
    --batch-size 50000 \
    --incremental \
    --resume \
    --verbose

EXIT_CODE=$?

echo ""
echo "================================================"
echo "Scan Summary"
echo "================================================"
echo "Directory: ${DIR}"
echo "Exit Code: ${EXIT_CODE}"
echo "End Time: $(date)"
echo "Output Files: ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet"
echo "Manifest: ${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json"
echo ""

# Show output file info
if [ ${EXIT_CODE} -eq 0 ]; then
    echo "✓ Scan completed successfully"
    echo ""
    echo "Output Summary:"
    ls -lh ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet 2>/dev/null | wc -l | xargs echo "  Chunks:"
    du -sh ${OUTPUT_DIR}/${DIR}_${DATE}_chunk_*.parquet 2>/dev/null | tail -1 | awk '{print "  Total Size: " $1}'

    # Show manifest summary if it exists
    if [ -f "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" ]; then
        echo ""
        echo "Manifest Summary:"
        grep -E '"total_rows"|"chunk_count"|"completed"' "${OUTPUT_DIR}/${DIR}_${DATE}_manifest.json" | sed 's/^/  /'
    fi
else
    echo "✗ Scan failed with exit code ${EXIT_CODE}"
    echo "Check error log: slurm_out/scan_${SLURM_ARRAY_TASK_ID}.err"
fi

echo "================================================"

exit ${EXIT_CODE}
