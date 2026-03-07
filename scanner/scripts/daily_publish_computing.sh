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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_SCRIPT="${SCRIPT_DIR}/publish_scans_computing.sh"

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

# Resubmit itself in 15 minutes
echo ""
echo "Scheduling next publish in 15 minutes..."
sbatch --begin=now+15minutes "$0"

echo "Computing publish finished at $(date)"
