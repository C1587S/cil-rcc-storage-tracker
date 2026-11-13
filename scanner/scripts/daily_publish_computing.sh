#!/bin/bash
#SBATCH --job-name=cil_computing_publish
#SBATCH --account=pi-mgreenst
#SBATCH --partition=broadwl
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=1G
#SBATCH --time=0:10:00
#SBATCH -o ./slurm_out/cil_computing_publish_%j.out
#SBATCH -e ./slurm_out/cil_computing_publish_%j.err
# =============================================================================
# Computing publish — Midway2, every 15 minutes (2 minutes after the scan).
# publish_scans_computing.sh runs the Midway2 scan, picks up the Midway3 scan
# from shared scratch, merges both and publishes to
# ~/public_html/cil_scans/quotas/.
#
# Scheduling goes through scanner/scripts/lib/chain.sh (next run queued
# FIRST, duplicate and overlap protection).
#
# Start the chain (Midway2 login node, from the repository root):
#   mkdir -p slurm_out
#   sbatch --account=<billing acct> scanner/scripts/daily_publish_computing.sh
# Stop it:
#   scancel -u $USER -n cil_computing_publish
# =============================================================================
set -eo pipefail

REPO_DIR="${SLURM_SUBMIT_DIR:-$PWD}"
CHAIN_SCRIPT="scanner/scripts/daily_publish_computing.sh"
# shellcheck source=lib/chain.sh
source "$REPO_DIR/scanner/scripts/lib/chain.sh"

PUBLISH_SCRIPT="./scanner/scripts/publish_scans_computing.sh"

chain_init
chain_guard_overlap
chain_schedule_next "$(chain_next_quarter 2)" \
  || chain_log "continuing despite the scheduling failure"

if [[ ! -f "$PUBLISH_SCRIPT" ]]; then
    chain_log "ERROR: publish script not found at $PUBLISH_SCRIPT"
    exit 1
fi

# Keep 100 reports (~25 hours at 15 min intervals)
chain_log "running publish"
bash "$PUBLISH_SCRIPT" --keep 100
chain_log "computing publish finished"
