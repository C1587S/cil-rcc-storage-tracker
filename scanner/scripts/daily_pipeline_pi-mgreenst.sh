#!/bin/bash
#SBATCH --job-name=mgreenst_projection_scan
#SBATCH --account=pi-mgreenst
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=2G
#SBATCH --time=0:15:00
#SBATCH -o ./slurm_out/projection_scan_%j.out
#SBATCH -e ./slurm_out/projection_scan_%j.err
# Projection monitor scan — runs on Midway3 every 15 minutes
# Executes pi-mgreenst_scan_computing.sh and saves JSON to shared scratch
# (visible from Midway2 for the publish job).
#
# First run (manual, from Midway3):
#   sbatch scanner/scripts/daily_pipeline_pi-mgreenst.sh
#
# After that it resubmits itself automatically every 15 minutes.
#
# To stop it:
#   scancel <job_id>  # find it with: squeue -u $USER --name=mgreenst_projection_scan

set -e

SCAN_SCRIPT="./scanner/scripts/pi-mgreenst_scan_computing.sh"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans/projections"

echo "Projection scan started at $(date)"
echo "Running on: $(hostname)"

mkdir -p slurm_out

# Check scan script exists
if [[ ! -f "$SCAN_SCRIPT" ]]; then
    echo "Error: scan script not found at $SCAN_SCRIPT"
    exit 1
fi

# Run scan, save JSON to scratch
mkdir -p "$OUTPUT_DIR"
echo "Running projection monitor scan..."
SCAN_PATH=$(bash "$SCAN_SCRIPT" --json --outdir "$OUTPUT_DIR")

if [[ -z "$SCAN_PATH" || ! -f "$SCAN_PATH" ]]; then
    echo "Warning: scan failed or produced no output."
else
    echo "Scan saved to: $SCAN_PATH"
fi

# Calculate next quarter-hour (:00, :15, :30, :45)
CURRENT_MIN=$(date +%-M)
NEXT_QUARTER=$(( ((CURRENT_MIN / 15) + 1) * 15 ))
if [[ "$NEXT_QUARTER" -ge 60 ]]; then
    NEXT_TIME=$(date -d "+1 hour" +%Y-%m-%dT%H:00:00)
else
    NEXT_TIME=$(date +%Y-%m-%dT%H:$(printf '%02d' $NEXT_QUARTER):00)
fi

echo ""
echo "Scheduling next scan at $NEXT_TIME..."
sbatch --begin="$NEXT_TIME" "$0"

echo "Projection scan finished at $(date)"
