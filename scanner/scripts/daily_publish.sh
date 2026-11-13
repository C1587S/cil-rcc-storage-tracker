#!/bin/bash
#SBATCH --job-name=cil_daily_publish
#SBATCH --account=pi-mgreenst
#SBATCH --partition=broadwl
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=2G
#SBATCH --time=1:00:00
#SBATCH -o ./slurm_out/cil_daily_publish_%j.out
#SBATCH -e ./slurm_out/cil_daily_publish_%j.err
# =============================================================================
# Daily publish (Midway2, where ~/public_html is served).
#
#   1. Schedules tomorrow's run FIRST (scanner/scripts/lib/chain.sh).
#   2. Publishes only a scan the Midway3 finalize step verified
#      (.scan_complete), never one that is still being written
#      (.scan_running younger than 26 h).
#   3. Fails (Slurm mail) whenever the newest published scan is more than
#      MAX_SCAN_AGE_DAYS old — a stopped scan chain is noticed in days, not
#      weeks.
#
# Start the chain (Midway2 login node, from the repository root):
#   mkdir -p slurm_out
#   sbatch --account=<acct> --begin=04:00 scanner/scripts/daily_publish.sh
# Stop it:
#   scancel -u $USER -n cil_daily_publish
# =============================================================================
set -eo pipefail

REPO_DIR="${SLURM_SUBMIT_DIR:-$PWD}"
CHAIN_SCRIPT="scanner/scripts/daily_publish.sh"
# shellcheck source=lib/chain.sh
source "$REPO_DIR/scanner/scripts/lib/chain.sh"

SOURCE_DIR="${SOURCE_DIR:-/scratch/midway3/${USER}/cil_scans}"
PUBLISH_DIR="${PUBLISH_DIR:-${HOME}/public_html/cil_scans}"
FLAG_FILE="${SOURCE_DIR}/.scan_complete"
RUNNING_MARK="${SOURCE_DIR}/.scan_running"
MAX_SCAN_AGE_DAYS="${MAX_SCAN_AGE_DAYS:-2}"

chain_init
chain_guard_overlap
chain_schedule_next "$(date -d 'tomorrow 04:00' +%Y-%m-%dT%H:%M:%S)" \
  || chain_log "continuing despite the scheduling failure"

if [ -f "$RUNNING_MARK" ] && [ -n "$(find "$RUNNING_MARK" -mmin -$((26 * 60)) 2>/dev/null)" ]; then
  chain_log "a scan is still running ($(cat "$RUNNING_MARK")); not publishing yet"
  # Look again in 2 h instead of waiting a whole day (bounded: the mark
  # stops counting as "running" after 26 h).
  sbatch --account="$ACCOUNT" --job-name="$CHAIN_NAME" --dependency=singleton \
         --begin=now+2hours --export=ALL,CHAIN_ONCE=1 --chdir="$CHAIN_REPO_DIR" \
         --output="$CHAIN_LOG_DIR/${CHAIN_NAME}_%j.out" --error="$CHAIN_LOG_DIR/${CHAIN_NAME}_%j.err" \
         "$CHAIN_REPO_DIR/$CHAIN_SCRIPT" >/dev/null \
    && chain_log "queued a one-off publish retry in 2 h" \
    || chain_log "WARNING: could not queue the retry; tomorrow's run will publish"
elif [ -f "$FLAG_FILE" ]; then
  chain_log "verified scan ready: $(tr '\n' ' ' < "$FLAG_FILE")"
  bash scanner/scripts/publish_scans.sh --clean
else
  chain_log "no verified scan waiting ($FLAG_FILE absent)"
fi

# Staleness alarm: age of the newest published scan manifest.
NEWEST=$(find "$PUBLISH_DIR" -maxdepth 1 -name '*_manifest.json' -printf '%T@ %f\n' 2>/dev/null | sort -n | tail -1)
if [ -z "$NEWEST" ]; then
  chain_log "ALERT: nothing is published in $PUBLISH_DIR"
  exit 1
fi
AGE_DAYS=$(( ( $(date +%s) - ${NEWEST%%.*} ) / 86400 ))
if [ "$AGE_DAYS" -gt "$MAX_SCAN_AGE_DAYS" ]; then
  chain_log "ALERT: newest published scan (${NEWEST#* }) is ${AGE_DAYS} days old (limit ${MAX_SCAN_AGE_DAYS}). Check the Midway3 chain: squeue -u \$USER -n cil_daily_pipeline"
  exit 1   # FAIL -> Slurm mail; tomorrow's run is already queued
fi
chain_log "newest published scan is ${AGE_DAYS} day(s) old"
