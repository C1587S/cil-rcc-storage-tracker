#!/bin/bash
#SBATCH --job-name=cil_reports
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=04:00:00
#SBATCH --array=0-6
#SBATCH -o /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/OUTPUTS/cil_reports/slurm_out/report_%a.out
#SBATCH -e /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/OUTPUTS/cil_reports/slurm_out/report_%a.err

################################################################################
# Generate CIL Storage Audit Reports (Parallel Slurm Version)
#
# This script generates comprehensive audit reports for all scanned CIL
# directories in parallel using Slurm job arrays. Each job processes one
# directory independently.
#
# The script automatically detects the most recent scan date for each directory.
#
# Usage:
#   mkdir -p /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/OUTPUTS/cil_reports/slurm_out
#   sbatch scripts/generate_cil_reports_parallel.sh
#
# Output:
#   Reports will be saved to:
#   /project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/OUTPUTS/cil_reports/${DIR}/${DATE}/
################################################################################

set -e  # Exit on error

# Configuration
SCAN_BASE="/project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/OUTPUTS/cil_scans"
REPORT_BASE="/project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker/OUTPUTS/cil_reports"
PROJECT_ROOT="/project/cil/home_dirs/scadavidsanchez/projects/cil-rcc-storage-tracker"
REPORT_SCRIPT="${PROJECT_ROOT}/reports/scripts/generate_report.py"

# Target directories (must match scanner output structure)
DIRS=(
    "battuta-shares-S3-archive"
    "battuta_shares"
    "gcp"
    "home_dirs"
    "kupe_shares"
    "norgay"
    "sacagawea_shares"
)

# Corresponding actual paths to scan
declare -A DIR_PATHS=(
    ["battuta-shares-S3-archive"]="/project/cil/battuta-shares-S3-archive"
    ["battuta_shares"]="/project/cil/battuta_shares"
    ["gcp"]="/project/cil/gcp"
    ["home_dirs"]="/project/cil/home_dirs"
    ["kupe_shares"]="/project/cil/kupe_shares"
    ["norgay"]="/project/cil/norgay"
    ["sacagawea_shares"]="/project/cil/sacagawea_shares"
)

# Get directory for this array task
DIR=${DIRS[$SLURM_ARRAY_TASK_ID]}
TARGET_PATH="${DIR_PATHS[$DIR]}"
DIR_SCAN_BASE="${SCAN_BASE}/${DIR}"

echo "========================================================================"
echo "CIL Storage Audit Report Generation"
echo "========================================================================"
echo "Array Task ID: ${SLURM_ARRAY_TASK_ID} / ${#DIRS[@]}"
echo "Directory: ${DIR}"
echo "Target Path: ${TARGET_PATH}"
echo "Node: $(hostname)"
echo "CPUs: ${SLURM_CPUS_PER_TASK}"
echo "Memory: 32G"
echo "Start Time: $(date)"
echo "========================================================================"
echo ""

# Check if directory scan base exists
if [ ! -d "${DIR_SCAN_BASE}" ]; then
    echo "ERROR: No scan directory found for ${DIR}"
    echo "Expected: ${DIR_SCAN_BASE}"
    exit 1
fi

# Find the most recent date subdirectory
DATE=$(ls -1 "${DIR_SCAN_BASE}" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | sort -r | head -1)

if [ -z "${DATE}" ]; then
    echo "ERROR: No date subdirectories found in ${DIR_SCAN_BASE}"
    echo "Available subdirectories:"
    ls -1 "${DIR_SCAN_BASE}"
    exit 1
fi

echo "Detected scan date: ${DATE}"

SCAN_DIR="${DIR_SCAN_BASE}/${DATE}"
REPORT_DIR="${REPORT_BASE}/${DIR}/${DATE}"

echo "Scan Directory: ${SCAN_DIR}"
echo "Report Directory: ${REPORT_DIR}"
echo ""

# Load Python environment
echo "Loading Python environment..."
module load python
source activate /project/cil/home_dirs/rcc/envs/storage_scanner
echo ""

# Verify report script exists
if [ ! -f "${REPORT_SCRIPT}" ]; then
    echo "ERROR: Report generation script not found: ${REPORT_SCRIPT}"
    exit 1
fi

# Check if scan directory exists
if [ ! -d "${SCAN_DIR}" ]; then
    echo "ERROR: Scan directory not found: ${SCAN_DIR}"
    echo "Please run the scanner first for ${DIR} on ${DATE}"
    exit 1
fi

# Check for parquet files (chunks or single file)
PARQUET_COUNT=$(ls "${SCAN_DIR}"/*.parquet 2>/dev/null | wc -l)
if [ ${PARQUET_COUNT} -eq 0 ]; then
    echo "ERROR: No parquet files found in ${SCAN_DIR}"
    exit 1
fi

echo "Found ${PARQUET_COUNT} parquet file(s)"
ls -lh "${SCAN_DIR}"/*.parquet
echo ""

# Create report output directory
mkdir -p "${REPORT_DIR}"

# Build parquet glob pattern
# DuckDB can handle both chunk_*.parquet and single files with glob
PARQUET_PATTERN="${SCAN_DIR}/*.parquet"

echo "Parquet Pattern: ${PARQUET_PATTERN}"
echo ""
echo "Generating report..."
echo ""

# Generate report with timing
START_TIME=$(date +%s)

/usr/bin/time -v python "${REPORT_SCRIPT}" \
    "${PARQUET_PATTERN}" \
    "${TARGET_PATH}" \
    "${REPORT_DIR}"

EXIT_CODE=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "========================================================================"
echo "Report Generation Summary"
echo "========================================================================"
echo "Directory: ${DIR}"
echo "Exit Code: ${EXIT_CODE}"
echo "Duration: ${DURATION} seconds"
echo "End Time: $(date)"
echo ""

if [ ${EXIT_CODE} -eq 0 ]; then
    echo "SUCCESS: Report generated for ${DIR}"
    echo ""
    echo "Output files:"
    ls -lh "${REPORT_DIR}"/*.{md,html} 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    echo ""
    echo "Report locations:"
    echo "  Markdown: ${REPORT_DIR}/audit_report_${DIR}_${DATE}.md"
    echo "  HTML: ${REPORT_DIR}/audit_report_${DIR}_${DATE}.html"
else
    echo "FAILED: Could not generate report for ${DIR}"
fi

echo "========================================================================"

exit ${EXIT_CODE}
