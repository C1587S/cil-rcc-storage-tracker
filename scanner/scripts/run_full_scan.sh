#!/bin/bash
# =============================================================================
# run_full_scan.sh - Single entrypoint for a complete storage scan
#
# Run on a MIDWAY3 LOGIN node:
#   bash scanner/scripts/run_full_scan.sh
#
# It does everything:
#   1. Submits the Slurm array for all compute-scannable sources
#      (/project/cil/* -- tasks 0-6,8)
#   2. Starts the cds3 scan on this login node (background, lock-guarded,
#      resumable), because /cds3 is not mounted on compute nodes
#   3. Prints the commands to monitor both
#
# When everything is done, publish from Midway2:
#   bash scanner/scripts/publish_scans.sh --clean     # full set
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(hostname)" != *"midway3"* ]]; then
    echo "Error: run this on a Midway3 login node."
    exit 1
fi

mkdir -p slurm_out

echo "=== 1/2 Submitting Slurm scan array (all sources except cds3) ==="
ACCOUNT="${CIL_SLURM_ACCOUNT:-${SLURM_JOB_ACCOUNT:-cil}}"
JOB_ID=$(sbatch --parsable --account="$ACCOUNT" "${SCRIPT_DIR}/scan_cil_parallel.sh")
echo "  Submitted array job: $JOB_ID"

echo ""
echo "=== 2/2 Starting cds3 scan on this login node ==="
CDS3_LOG="$HOME/cds3_scan.log"
nohup bash "${SCRIPT_DIR}/scan_cds3_login.sh" > "$CDS3_LOG" 2>&1 &
echo "  PID $! (log: $CDS3_LOG)"
echo "  (If a cds3 scan is already running, the lock makes this a no-op.)"

echo ""
echo "Monitor with:"
echo "  squeue -j $JOB_ID"
echo "  sacct -j $JOB_ID --format=JobID%15,State,Elapsed -n"
echo "  tail -n 5 $CDS3_LOG"
