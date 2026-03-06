#!/bin/bash
#SBATCH --job-name=cil_daily_pipeline
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=4G
#SBATCH --time=2:00:00
#SBATCH -o ./slurm_out/pipeline_%j.out
#SBATCH -e ./slurm_out/pipeline_%j.err
# Daily pipeline orchestrator
# Submits the scan array, waits for completion, publishes and cleans scratch.
# At the end, resubmits itself to run again the next day at 2am.
#
# First run (manual):
#   sbatch --begin=02:00 scanner/scripts/daily_pipeline.sh
#
# After that it resubmits itself automatically every day.
#
# To stop it:
#   scancel <job_id>  # find it with: squeue -u $USER

set -e

SCAN_SCRIPT="./scanner/scripts/scan_cil_parallel.sh"
PUBLISH_SCRIPT="./scanner/scripts/publish_scans.sh"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"

echo "Daily pipeline started at $(date)"
echo "Running on: $(hostname)"

# Clean slurm logs from previous run
echo "Cleaning previous slurm logs..."
mkdir -p slurm_out
rm -f slurm_out/scan_*.out slurm_out/scan_*.err

# Submit scan job array
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
    echo "Check logs in slurm_out/ for details."
    echo "Skipping publish step."
else
    # Verify output files exist
    echo ""
    echo "Verifying output files..."
    FILE_COUNT=$(ls "$OUTPUT_DIR"/*.parquet 2>/dev/null | wc -l)
    if [ "$FILE_COUNT" -eq 0 ]; then
        echo "Error: No parquet files found in $OUTPUT_DIR"
    else
        echo "Found $FILE_COUNT parquet file(s) in $OUTPUT_DIR"
        du -sh "$OUTPUT_DIR"

        # Publish and clean
        echo ""
        echo "Publishing results..."
        bash "$PUBLISH_SCRIPT" --clean
        echo "Results available at: http://users.rcc.uchicago.edu/~${USER}/cil_scans/"
    fi
fi

# Resubmit itself for tomorrow at 2am
echo ""
echo "Scheduling next run for tomorrow at 2am..."
sbatch --begin=$(date -d "tomorrow 02:00" +%Y-%m-%dT%H:%M:%S) "$0"
echo "Done. Next run scheduled."

echo ""
echo "Pipeline finished at $(date)"