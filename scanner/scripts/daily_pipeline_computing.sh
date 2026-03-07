#!/bin/bash
#SBATCH --job-name=cil_computing_scan
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=1G
#SBATCH --time=0:10:00
#SBATCH -o ./slurm_out/computing_scan_%j.out
#SBATCH -e ./slurm_out/computing_scan_%j.err
# Computing scan — runs on Midway3 every 15 minutes
# Executes cil_scan_computing.sh and saves JSON to shared scratch
# (visible from Midway2 for the publish job).
#
# First run (manual, from Midway3):
#   sbatch scanner/scripts/daily_pipeline_computing.sh
#
# After that it resubmits itself automatically every 15 minutes.
#
# To stop it:
#   scancel <job_id>  # find it with: squeue -u $USER --name=cil_computing_scan

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_SCRIPT="${SCRIPT_DIR}/cil_scan_computing.sh"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
ACCOUNT="${CIL_ACCOUNT:-cil}"

echo "Computing scan started at $(date)"
echo "Running on: $(hostname)"

mkdir -p slurm_out

# Check scan script exists
if [[ ! -f "$SCAN_SCRIPT" ]]; then
    echo "Error: scan script not found at $SCAN_SCRIPT"
    exit 1
fi

# Run scan, save JSON to scratch
mkdir -p "$OUTPUT_DIR"
echo "Running computing scan..."
SCAN_PATH=$(bash "$SCAN_SCRIPT" --json --outdir "$OUTPUT_DIR" -a "$ACCOUNT")

if [[ -z "$SCAN_PATH" || ! -f "$SCAN_PATH" ]]; then
    echo "Warning: scan failed or produced no output."
else
    echo "Scan saved to: $SCAN_PATH"
fi

# Resubmit itself in 15 minutes
echo ""
echo "Scheduling next scan in 15 minutes..."
sbatch --begin=now+15minutes "$0"

echo "Computing scan finished at $(date)"
