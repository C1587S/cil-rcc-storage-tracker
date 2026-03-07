#!/bin/bash
#SBATCH --job-name=cil_computing_publish
#SBATCH --account=cil
#SBATCH --partition=broadwl
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=1G
#SBATCH --time=0:10:00
#SBATCH -o ./slurm_out/computing_publish_%j.out
#SBATCH -e ./slurm_out/computing_publish_%j.err
# Computing publish — runs on Midway2 every 15 minutes
# Executes publish_scans_computing.sh which:
#   1. Runs local Midway2 scan
#   2. Picks up Midway3 scan from shared scratch
#   3. Merges into combined report
#   4. Publishes to ~/public_html/cil_scans/quotas/
#
# First run (manual, from Midway2):
#   sbatch scanner/scripts/daily_publish_computing.sh
#
# After that it resubmits itself automatically every 15 minutes.
#
# To stop it:
#   scancel <job_id>  # find it with: squeue -u $USER --name=cil_computing_publish

set -e

PUBLISH_SCRIPT="./scanner/scripts/publish_scans_computing.sh"

echo "Computing publish started at $(date)"
echo "Running on: $(hostname)"

mkdir -p slurm_out

# Check publish script exists
if [[ ! -f "$PUBLISH_SCRIPT" ]]; then
    echo "Error: publish script not found at $PUBLISH_SCRIPT"
    exit 1
fi

# Run publish (scan + merge + publish + prune)
# Keep 100 reports (~25 hours at 15 min intervals)
echo "Running publish..."
bash "$PUBLISH_SCRIPT" --keep 100

# Calculate next quarter-hour + 2 min (:02, :17, :32, :47)
CURRENT_MIN=$(date +%-M)
NEXT_QUARTER=$(( ((CURRENT_MIN / 15) + 1) * 15 ))
if [[ "$NEXT_QUARTER" -ge 60 ]]; then
    NEXT_TIME=$(date -d "+1 hour" +%Y-%m-%dT%H:02:00)
else
    NEXT_TIME=$(date +%Y-%m-%dT%H:$(printf '%02d' $((NEXT_QUARTER + 2))):00)
fi

echo ""
echo "Scheduling next publish at $NEXT_TIME..."
sbatch --begin="$NEXT_TIME" "$0"

echo "Computing publish finished at $(date)"
