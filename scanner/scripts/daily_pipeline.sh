#!/bin/bash
#SBATCH --job-name=cil_daily_pipeline
#SBATCH --account=cil
#SBATCH --partition=caslake
#SBATCH --cpus-per-task=1
#SBATCH --ntasks=1
#SBATCH --mem=1G
#SBATCH --time=00:15:00
#SBATCH -o ./slurm_out/cil_daily_pipeline_%j.out
#SBATCH -e ./slurm_out/cil_daily_pipeline_%j.err
# =============================================================================
# Daily storage scan orchestrator (Midway3).
#
#   1. Schedules tomorrow's run FIRST (scanner/scripts/lib/chain.sh), so a
#      failure later in this job can never stop the chain.
#   2. Refuses to start a scan while one is queued or running.
#   3. Submits the scan array (scan_cil_parallel.sh) with one SCAN_DATE.
#   4. Submits a short finalize job (afterany) that checks every source
#      produced a completed manifest and only then writes the publish flag
#      read by daily_publish.sh on Midway2. Nothing waits for 12 hours.
#
# Start the chain (Midway3 login node, from the repository root):
#   mkdir -p slurm_out
#   sbatch --account=<acct> --begin=02:00 scanner/scripts/daily_pipeline.sh
# One-off scan now, without touching the chain:
#   sbatch --account=<acct> --export=ALL,CHAIN_ONCE=1 scanner/scripts/daily_pipeline.sh
# Stop it:
#   scancel -u $USER -n cil_daily_pipeline
# =============================================================================
set -eo pipefail

REPO_DIR="${SLURM_SUBMIT_DIR:-$PWD}"
CHAIN_SCRIPT="scanner/scripts/daily_pipeline.sh"
# shellcheck source=lib/chain.sh
source "$REPO_DIR/scanner/scripts/lib/chain.sh"

OUTPUT_DIR="${CIL_SCAN_OUTPUT_DIR:-/scratch/midway3/${USER}/cil_scans}"
FLAG_FILE="${OUTPUT_DIR}/.scan_complete"
RUNNING_MARK="${OUTPUT_DIR}/.scan_running"
SCAN_SCRIPT="scanner/scripts/scan_cil_parallel.sh"
# Sources the array scans by default (task ids 0-6,8 in scan_cil_parallel.sh;
# cds3 is scanned from a login node and published separately).
EXPECTED_SOURCES="battuta-shares-S3-archive battuta_shares gcp home_dirs kupe_shares norgay sacagawea_shares coastal"

finalize() {
  local array_id="$1" date="$2" failed="" missing="" src m rows total=0
  chain_log "finalizing scan array $array_id for $date"
  rm -f "$RUNNING_MARK"
  failed=$(sacct -j "$array_id" -X -n -o JobID,State 2>/dev/null \
             | awk '$2 != "COMPLETED" {print $1 ":" $2}' | tr '\n' ' ')
  for src in $EXPECTED_SOURCES; do
    m="${OUTPUT_DIR}/${src}_${date}_manifest.json"
    if [ -f "$m" ] && grep -q '"completed": *true' "$m"; then
      rows=$(grep -o '"total_rows": *[0-9]*' "$m" | grep -o '[0-9]*$')
      if [ "${rows:-0}" -gt 0 ]; then total=$((total + rows)); continue; fi
    fi
    missing="$missing $src"
  done
  if [ -n "$failed" ] || [ -n "$missing" ]; then
    chain_log "NOT publishing $date. Failed tasks: ${failed:-none}. Sources without a completed manifest:${missing:- none}"
    chain_log "Rerun just the failed sources (completed ones are skipped):"
    chain_log "  sbatch --account=$ACCOUNT --job-name=cil_scan --export=ALL,SCAN_DATE=$date $SCAN_SCRIPT"
    exit 1   # FAIL -> Slurm mail
  fi
  printf 'date=%s\nrows=%s\nfinalized=%s\narray=%s\n' "$date" "$total" "$(date -Is)" "$array_id" > "${FLAG_FILE}.tmp"
  mv "${FLAG_FILE}.tmp" "$FLAG_FILE"
  chain_log "all $(echo $EXPECTED_SOURCES | wc -w) sources complete for $date ($total rows); flag written: $FLAG_FILE"
}

chain_init

if [ "${1:-}" = "--finalize" ]; then
  finalize "$2" "$3"
  exit 0
fi

# Cadence and metadata pressure, both inherited by later runs (sbatch
# exports the environment): CIL_SCAN_INTERVAL_DAYS (default 1) and
# CIL_SCAN_CPUS = scanner threads per source (default 8, from the array
# header). Fewer threads = fewer concurrent stat calls on GPFS, longer runs.
INTERVAL_DAYS="${CIL_SCAN_INTERVAL_DAYS:-1}"

chain_guard_overlap
chain_schedule_next "$(date -d "+${INTERVAL_DAYS} days 02:00" +%Y-%m-%dT%H:%M:%S)" \
  || chain_log "continuing with today's scan despite the scheduling failure"

if [ -n "$(squeue -h -u "$USER" -n cil_scan -o %i 2>/dev/null)" ]; then
  chain_log "a cil_scan array is already queued or running; not starting another"
  exit 0
fi

DATE=$(date +%Y-%m-%d)
mkdir -p "$OUTPUT_DIR"
rm -f "$CHAIN_LOG_DIR"/scan_*.out "$CHAIN_LOG_DIR"/scan_*.err
echo "started=$(date -Is) date=$DATE" > "$RUNNING_MARK"

CPU_ARGS=()
[ -n "${CIL_SCAN_CPUS:-}" ] && CPU_ARGS=(--cpus-per-task="$CIL_SCAN_CPUS")
ARRAY_ID=$(sbatch --parsable --account="$ACCOUNT" --job-name=cil_scan "${CPU_ARGS[@]}" \
             --export=ALL,SCAN_DATE="$DATE" "$SCAN_SCRIPT")
ARRAY_ID="${ARRAY_ID%%;*}"
chain_log "submitted scan array $ARRAY_ID for $DATE"

FIN_ID=$(sbatch --parsable --account="$ACCOUNT" --job-name=cil_scan_finalize \
           --dependency=afterany:"$ARRAY_ID" --time=00:10:00 --mem=1G \
           --output="$CHAIN_LOG_DIR/cil_scan_finalize_%j.out" \
           --error="$CHAIN_LOG_DIR/cil_scan_finalize_%j.err" \
           --mail-type=FAIL --mail-user="${CIL_ALERT_EMAIL:-$USER@uchicago.edu}" \
           --export=ALL,CHAIN_ONCE=1 \
           "$CHAIN_SCRIPT" --finalize "$ARRAY_ID" "$DATE")
chain_log "finalize job ${FIN_ID%%;*} will verify the array and write the publish flag"
