#!/bin/bash
#SBATCH --job-name=mgreenst_projection_publish
#SBATCH --account=cil
#SBATCH --partition=broadwl
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=1G
#SBATCH --time=0:15:00
#SBATCH -o ./slurm_out/projection_publish_%j.out
#SBATCH -e ./slurm_out/projection_publish_%j.err
# Projection scan + publish — runs on Midway2 every 15 minutes
# 1. Runs the projection scan locally (squeue/sacct/file inventory)
# 2. Publishes the report to public_html
#
# This is the only job you need on Midway2. The scan runs here because
# squeue/sacct work from any cluster, and /project/cil is accessible.
#
# First run (manual, from Midway2):
#   sbatch scanner/scripts/daily_publish_pi-mgreenst.sh
#
# After that it resubmits itself automatically every 15 minutes.
#
# To stop it:
#   scancel <job_id>  # find it with: squeue -u $USER --name=mgreenst_projection_publish

set -e

PUBLISH_SCRIPT="./scanner/scripts/publish_projections.sh"

echo "Projection publish started at $(date)"
echo "Running on: $(hostname)"

mkdir -p slurm_out

if [[ ! -f "$PUBLISH_SCRIPT" ]]; then
    echo "Error: publish script not found at $PUBLISH_SCRIPT"
    exit 1
fi

# Run scan + publish (scan runs locally, then publishes)
echo "Running scan + publish..."
bash "$PUBLISH_SCRIPT" --keep 50

# Calculate next quarter-hour + 5 min offset (:05, :20, :35, :50)
CURRENT_MIN=$(date +%-M)
NEXT_QUARTER=$(( ((CURRENT_MIN / 15) + 1) * 15 ))
if [[ "$NEXT_QUARTER" -ge 60 ]]; then
    NEXT_TIME=$(date -d "+1 hour" +%Y-%m-%dT%H:05:00)
else
    NEXT_TIME=$(date +%Y-%m-%dT%H:$(printf '%02d' $((NEXT_QUARTER + 5))):00)
fi

echo ""
echo "Scheduling next publish at $NEXT_TIME..."
sbatch --begin="$NEXT_TIME" "$0"

echo "Projection publish finished at $(date)"
