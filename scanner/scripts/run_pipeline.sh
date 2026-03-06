#!/bin/bash
# Full pipeline: scan -> publish -> clean
# Submits the scan job array, waits for all jobs to finish,
# publishes results to public_html, and cleans scratch if successful.
#
# Must be run from Midway2: ssh midway2.rcc.uchicago.edu
#
# Usage:
#   bash scanner/scripts/run_pipeline.sh

set -e

SCAN_SCRIPT="./scanner/scripts/scan_cil_parallel.sh"
PUBLISH_SCRIPT="./scanner/scripts/publish_scans.sh"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
DATE=$(date +%Y-%m-%d)

# Check we are on Midway2
if [[ "$(hostname)" != *"midway2"* ]]; then
    echo "Error: This script must be run from Midway2"
    echo "Connect first with: ssh midway2.rcc.uchicago.edu"
    exit 1
fi

# Clean slurm logs from previous run
echo "Cleaning previous slurm logs..."
mkdir -p slurm_out
rm -f slurm_out/*.out slurm_out/*.err

# Submit job array
echo "Submitting scan job array..."
JOB_ID=$(sbatch --parsable "$SCAN_SCRIPT")
echo "Submitted job array: $JOB_ID"

# Wait for all jobs to finish
echo ""
echo "Waiting for all jobs to finish..."
while true; do
    RUNNING=$(squeue -j "$JOB_ID" -h 2>/dev/null | wc -l)
    if [ "$RUNNING" -eq 0 ]; then
        break
    fi
    echo "  $(date +%H:%M:%S) - $RUNNING job(s) still running..."
    sleep 60
done
echo "All jobs finished."

# Check for failures
echo ""
echo "Checking for failures..."
FAILED=$(sacct -j "$JOB_ID" --format=JobID,State -n | grep -v "COMPLETED\|PENDING\|RUNNING" | grep -v "^$" || true)

if [ -n "$FAILED" ]; then
    echo "Warning: Some jobs did not complete successfully:"
    echo "$FAILED"
    echo ""
    echo "Check logs in slurm_out/ for details."
    echo "Aborting publish step."
    exit 1
fi
echo "All jobs completed successfully."

# Verify output files exist
echo ""
echo "Verifying output files..."
FILE_COUNT=$(ls "$OUTPUT_DIR"/*.parquet 2>/dev/null | wc -l)
if [ "$FILE_COUNT" -eq 0 ]; then
    echo "Error: No parquet files found in $OUTPUT_DIR"
    exit 1
fi
echo "Found $FILE_COUNT parquet file(s) in $OUTPUT_DIR"
du -sh "$OUTPUT_DIR"

# Publish and clean
echo ""
echo "Publishing results..."
bash "$PUBLISH_SCRIPT" --clean

echo ""
echo "Pipeline completed successfully."
echo "Results available at: http://users.rcc.uchicago.edu/~${USER}/cil_scans/"