#!/bin/bash
################################################################################
# Generate CIL Storage Audit Reports
#
# This script generates comprehensive audit reports for all scanned CIL
# directories. It reads the chunked parquet files from scanner outputs and
# generates detailed reports for each directory.
#
# The script automatically detects available scan dates from the scan directory
# structure and generates reports for each directory/date combination found.
#
# Usage:
#   ./scripts/generate_cil_reports.sh
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

echo "========================================================================"
echo "CIL Storage Audit Report Generation"
echo "========================================================================"
echo "Scan Base: ${SCAN_BASE}"
echo "Report Base: ${REPORT_BASE}"
echo "Directories: ${#DIRS[@]}"
echo "Start Time: $(date)"
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

# Track success/failure
SUCCESSFUL=0
FAILED=0
declare -a FAILED_DIRS
declare -a SUCCESSFUL_REPORTS

# Generate reports for each directory
for DIR in "${DIRS[@]}"; do
    echo "========================================================================"
    echo "[$((SUCCESSFUL + FAILED + 1))/${#DIRS[@]}] Processing: ${DIR}"
    echo "========================================================================"

    TARGET_PATH="${DIR_PATHS[$DIR]}"
    DIR_SCAN_BASE="${SCAN_BASE}/${DIR}"

    # Check if directory exists
    if [ ! -d "${DIR_SCAN_BASE}" ]; then
        echo "WARNING: No scan directory found for ${DIR}"
        echo "Skipping ${DIR}..."
        FAILED=$((FAILED + 1))
        FAILED_DIRS+=("${DIR} (no scan directory)")
        echo ""
        continue
    fi

    # Find all date subdirectories for this directory
    SCAN_DATES=($(ls -d "${DIR_SCAN_BASE}"/*/ 2>/dev/null | xargs -n 1 basename))

    if [ ${#SCAN_DATES[@]} -eq 0 ]; then
        echo "WARNING: No date subdirectories found in ${DIR_SCAN_BASE}"
        echo "Skipping ${DIR}..."
        FAILED=$((FAILED + 1))
        FAILED_DIRS+=("${DIR} (no date subdirectories)")
        echo ""
        continue
    fi

    echo "Found ${#SCAN_DATES[@]} scan date(s): ${SCAN_DATES[*]}"
    echo ""

    # Process each date
    for DATE in "${SCAN_DATES[@]}"; do
        echo "  Processing date: ${DATE}"

        SCAN_DIR="${DIR_SCAN_BASE}/${DATE}"
        REPORT_DIR="${REPORT_BASE}/${DIR}/${DATE}"

        # Check for parquet files (chunks or single file)
        PARQUET_COUNT=$(ls "${SCAN_DIR}"/*.parquet 2>/dev/null | wc -l)
        if [ ${PARQUET_COUNT} -eq 0 ]; then
            echo "  WARNING: No parquet files found in ${SCAN_DIR}"
            echo "  Skipping ${DIR}/${DATE}..."
            FAILED=$((FAILED + 1))
            FAILED_DIRS+=("${DIR}/${DATE} (no parquet files)")
            echo ""
            continue
        fi

        echo "  Found ${PARQUET_COUNT} parquet file(s)"

        # Create report output directory
        mkdir -p "${REPORT_DIR}"

        # Build parquet glob pattern
        PARQUET_PATTERN="${SCAN_DIR}/*.parquet"

        echo "  Parquet Pattern: ${PARQUET_PATTERN}"
        echo "  Report Directory: ${REPORT_DIR}"
        echo ""
        echo "  Generating report..."

        # Generate report
        if python "${REPORT_SCRIPT}" \
            "${PARQUET_PATTERN}" \
            "${TARGET_PATH}" \
            "${REPORT_DIR}"; then

            echo ""
            echo "  SUCCESS: Report generated for ${DIR}/${DATE}"
            SUCCESSFUL=$((SUCCESSFUL + 1))
            SUCCESSFUL_REPORTS+=("${DIR}/${DATE}")

            # Show output files
            echo "  Output files:"
            ls -lh "${REPORT_DIR}"/*.{md,html} 2>/dev/null | awk '{print "    " $9 " (" $5 ")"}'

        else
            echo ""
            echo "  FAILED: Could not generate report for ${DIR}/${DATE}"
            FAILED=$((FAILED + 1))
            FAILED_DIRS+=("${DIR}/${DATE} (generation failed)")
        fi

        echo ""
    done
done

# Final summary
echo "========================================================================"
echo "REPORT GENERATION SUMMARY"
echo "========================================================================"
echo "Total Directory/Date Combinations: $((SUCCESSFUL + FAILED))"
echo "Successful: ${SUCCESSFUL}"
echo "Failed: ${FAILED}"
echo "End Time: $(date)"
echo ""

if [ ${SUCCESSFUL} -gt 0 ]; then
    echo "Generated Reports:"
    for REPORT_ENTRY in "${SUCCESSFUL_REPORTS[@]}"; do
        DIR=$(echo "${REPORT_ENTRY}" | cut -d'/' -f1)
        DATE=$(echo "${REPORT_ENTRY}" | cut -d'/' -f2)
        REPORT_DIR="${REPORT_BASE}/${DIR}/${DATE}"
        echo "  - ${REPORT_ENTRY}:"
        echo "    HTML: ${REPORT_DIR}/audit_report_${DIR}_${DATE}.html"
        echo "    MD:   ${REPORT_DIR}/audit_report_${DIR}_${DATE}.md"
    done
    echo ""
fi

if [ ${FAILED} -gt 0 ]; then
    echo "Failed Reports:"
    for FAILED_DIR in "${FAILED_DIRS[@]}"; do
        echo "  - ${FAILED_DIR}"
    done
    echo ""
fi

echo "All reports are located in: ${REPORT_BASE}"
echo "========================================================================"

# Exit with error code if any failed
if [ ${FAILED} -gt 0 ]; then
    exit 1
else
    exit 0
fi
