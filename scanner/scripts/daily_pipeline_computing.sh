#!/bin/bash
#SBATCH --job-name=cil_computing_scan
#SBATCH --account=pi-mgreenst
#SBATCH --partition=cil
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=1G
#SBATCH --time=0:10:00
#SBATCH -o ./slurm_out/cil_computing_scan_%j.out
#SBATCH -e ./slurm_out/cil_computing_scan_%j.err
# =============================================================================
# Computing (SU / quota) scan — Midway3, every 15 minutes.
# Runs cil_scan_computing.sh (accounting and quota queries only, no
# filesystem traversal) and saves JSON to shared scratch for the Midway2
# publish job.
#
# Scheduling goes through scanner/scripts/lib/chain.sh: the next run is
# queued FIRST, from the repository copy of this script, with duplicate and
# overlap protection.
#
# Start the chain (Midway3 login node, from the repository root):
#   mkdir -p slurm_out
#   sbatch --account=<billing acct> scanner/scripts/daily_pipeline_computing.sh
# Stop it:
#   scancel -u $USER -n cil_computing_scan
#
# Two different accounts:
#   billing (who pays for this job): CIL_SLURM_ACCOUNT, else the account
#     this job runs under — chain.sh sets $ACCOUNT
#   reported (whose usage the scan reports): CIL_ACCOUNT, default "cil"
# =============================================================================
set -eo pipefail

REPO_DIR="${SLURM_SUBMIT_DIR:-$PWD}"
CHAIN_SCRIPT="scanner/scripts/daily_pipeline_computing.sh"
# shellcheck source=lib/chain.sh
source "$REPO_DIR/scanner/scripts/lib/chain.sh"

SCAN_SCRIPT="./scanner/scripts/cil_scan_computing.sh"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
REPORT_ACCOUNT="${CIL_ACCOUNT:-cil}"

chain_init
chain_guard_overlap
chain_schedule_next "$(chain_next_quarter 0)" \
  || chain_log "continuing despite the scheduling failure"

if [[ ! -f "$SCAN_SCRIPT" ]]; then
    chain_log "ERROR: scan script not found at $SCAN_SCRIPT"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"
chain_log "running computing scan for account $REPORT_ACCOUNT"
SCAN_PATH=$(bash "$SCAN_SCRIPT" --json --outdir "$OUTPUT_DIR" -a "$REPORT_ACCOUNT")

if [[ -z "$SCAN_PATH" || ! -f "$SCAN_PATH" ]]; then
    chain_log "ERROR: scan produced no output"
    exit 1   # FAIL -> Slurm mail; the next run is already queued
fi
chain_log "scan saved to: $SCAN_PATH"
