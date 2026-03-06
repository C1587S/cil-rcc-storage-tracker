#!/bin/bash
#SBATCH --job-name=cil_daily_publish
#SBATCH --account=cil
#SBATCH --partition=broadwl
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=4G
#SBATCH --time=1:00:00
#SBATCH -o ./slurm_out/publish_%j.out
#SBATCH -e ./slurm_out/publish_%j.err
# Daily publish job - runs on Midway2 at 4am
# Checks for scan flag from daily_pipeline.sh, publishes results, and cleans scratch.
#
# First run (manual, from Midway2):
#   sbatch --begin=04:00 scanner/scripts/daily_publish.sh
#
# After that it resubmits itself automatically every day.
#
# To stop it:
#   scancel <job_id>  # find it with: squeue -u $USER

set -e

PUBLISH_SCRIPT="./scanner/scripts/publish_scans.sh"
FLAG_FILE="/scratch/midway3/${USER}/cil_scans/.scan_complete"

echo "Daily publish started at $(date)"
echo "Running on: $(hostname)"

# Check for scan flag
if [ ! -f "$FLAG_FILE" ]; then
    echo "Flag not found at $FLAG_FILE"
    echo "Scan may have failed or not finished yet. Skipping publish."
else
    echo "Flag found: $(cat $FLAG_FILE)"
    echo "Starting publish..."
    bash "$PUBLISH_SCRIPT" --clean
    rm -f "$FLAG_FILE"
    echo "Flag removed."
fi

# Resubmit itself for tomorrow at 4am
echo ""
echo "Scheduling next publish for tomorrow at 4am..."
sbatch --begin=$(date -d "tomorrow 04:00" +%Y-%m-%dT%H:%M:%S) "$0"

echo "Publish job finished at $(date)"