# shellcheck shell=bash
# chain.sh — reliable self-rescheduling for the RCC Slurm chains.
#
# Each chain job (daily scan, daily publish, computing scan/publish) used to
# resubmit itself on its LAST line with `sbatch "$0"` under `set -e`. That
# failed in four ways, all observed in Sept 2026:
#   1. Any failure before the last line (a failed sbatch, an unreadable
#      directory, a node problem) ended the chain permanently.
#   2. Inside a job "$0" is Slurm's spooled copy of the script, so a chain
#      kept running the frozen version it was started with; `git pull` on
#      RCC never reached it.
#   3. Relative -o/-e paths depended on the submit directory.
#   4. Nothing stopped a second copy of a chain from running alongside the
#      first, forever.
#
# Usage (from a chain script, after its #SBATCH header):
#   CHAIN_SCRIPT="scanner/scripts/daily_pipeline.sh"   # repo-relative path
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/chain.sh"   # (or repo path)
#   chain_init                    # cd to the repo, set CHAIN_LOG_DIR/ACCOUNT
#   chain_guard_overlap           # exit 0 if another instance is running
#   chain_schedule_next "$BEGIN"  # FIRST: queue the next run, then work
#
# Environment:
#   CIL_SLURM_ACCOUNT   billing account override (else this job's account)
#   CIL_ALERT_EMAIL     Slurm failure mail (default: $USER@uchicago.edu)
#   CHAIN_ONCE=1        one-off run: do the work, never (re)schedule
#                       (sbatch --export=ALL,CHAIN_ONCE=1 <script>)
#   CHAIN_DRY_RUN=1     print the sbatch command instead of submitting

chain_log() { echo "[chain $(date '+%F %T')] $*"; }

# Next quarter hour after now, plus OFFSET minutes (0-14), for --begin.
# chain_next_quarter 2  ->  :02, :17, :32 or :47 of the next quarter.
chain_next_quarter() {
  local offset="${1:-0}" now next
  now=$(date +%s)
  next=$(( (now / 900 + 1) * 900 + offset * 60 ))
  date -d "@$next" +%Y-%m-%dT%H:%M:%S
}

chain_init() {
  : "${CHAIN_SCRIPT:?CHAIN_SCRIPT must be set to the repo-relative script path}"
  # SLURM_SUBMIT_DIR is where the chain was started (the repo root). Fall
  # back to the git root of this file for manual runs.
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CHAIN_REPO_DIR="${SLURM_SUBMIT_DIR:-$(cd "$lib_dir/../../.." && pwd)}"
  if [ ! -f "$CHAIN_REPO_DIR/$CHAIN_SCRIPT" ]; then
    # Submitted from somewhere else: use the repository this file lives in.
    CHAIN_REPO_DIR="$(cd "$lib_dir/../../.." && pwd)"
  fi
  cd "$CHAIN_REPO_DIR" || { chain_log "ERROR: cannot cd to $CHAIN_REPO_DIR"; return 1; }
  CHAIN_LOG_DIR="$CHAIN_REPO_DIR/slurm_out"
  mkdir -p "$CHAIN_LOG_DIR"
  ACCOUNT="${CIL_SLURM_ACCOUNT:-${SLURM_JOB_ACCOUNT:-cil}}"
  CHAIN_NAME="${SLURM_JOB_NAME:-$(basename "$CHAIN_SCRIPT" .sh)}"
  chain_log "job ${SLURM_JOB_ID:-manual} '$CHAIN_NAME' on $(hostname), repo $CHAIN_REPO_DIR, account $ACCOUNT"
  chain_log "repo version: $(git -C "$CHAIN_REPO_DIR" log -1 --format='%h %ad' --date=short 2>/dev/null || echo unknown)"
}

# Other jobs of this user with this name, as "jobid state begin_time" lines.
_chain_others() {
  squeue -h -u "$USER" -n "$CHAIN_NAME" -o '%i %T %S' 2>/dev/null \
    | awk -v me="${SLURM_JOB_ID:-0}" '$1 != me'
}

# Never run two instances at once (e.g. a run that overran into the next
# slot, or a manual sbatch next to the chain). Pending jobs are fine.
chain_guard_overlap() {
  local running
  running=$(_chain_others | awk '$2 == "RUNNING" {print $1}' | head -1)
  if [ -n "$running" ]; then
    chain_log "another '$CHAIN_NAME' is already running (job $running); this instance exits without working"
    exit 0
  fi
}

# Queue the next run of this chain at BEGIN (Slurm --begin syntax).
# Call it FIRST, so a failure later in the job cannot break the chain.
# Exactly one pending job per chain: if one is already queued when this
# instance starts, this instance is a duplicate (a second copy of the chain)
# and exits without working; if two instances race, the higher job id
# cancels its submission. Returns 1 (loudly) if scheduling failed; the
# caller should still do its work.
chain_schedule_next() {
  local begin="$1" pending new_id lowest rc=1 attempt
  if [ "${CHAIN_ONCE:-0}" = 1 ]; then
    chain_log "one-off run (CHAIN_ONCE=1): not scheduling a next run"
    return 0
  fi
  pending=$(_chain_others | awk '$2 == "PENDING" {print $1}')
  if [ -n "$pending" ]; then
    chain_log "next run already queued (job(s) $(echo $pending)): this instance is a duplicate chain; exiting without work"
    exit 0
  fi
  # --export=ALL explicitly: the chain's settings (CIL_SCAN_INTERVAL_DAYS,
  # CIL_SCAN_CPUS, MAX_SCAN_AGE_DAYS, CIL_SLURM_ACCOUNT, ...) must reach the
  # next run even if a site changes sbatch's default export behaviour.
  local args=(--parsable --account="$ACCOUNT" --begin="$begin" --export=ALL
              --job-name="$CHAIN_NAME" --dependency=singleton
              --chdir="$CHAIN_REPO_DIR"
              --output="$CHAIN_LOG_DIR/${CHAIN_NAME}_%j.out"
              --error="$CHAIN_LOG_DIR/${CHAIN_NAME}_%j.err"
              --mail-type=FAIL,TIME_LIMIT
              --mail-user="${CIL_ALERT_EMAIL:-$USER@uchicago.edu}"
              "$CHAIN_REPO_DIR/$CHAIN_SCRIPT")
  if [ "${CHAIN_DRY_RUN:-0}" = 1 ]; then
    chain_log "DRY RUN: sbatch ${args[*]}"
    return 0
  fi
  for attempt in 1 2 3; do
    if new_id=$(sbatch "${args[@]}" 2>&1); then rc=0; break; fi
    chain_log "WARNING: sbatch attempt $attempt failed: $new_id"
    sleep $((attempt * 30))
  done
  if [ "$rc" -ne 0 ]; then
    chain_log "ERROR: could not schedule the next '$CHAIN_NAME' run — the chain WILL STOP. Resubmit manually."
    return 1
  fi
  new_id="${new_id%%;*}"
  chain_log "next run queued as job $new_id (begin $begin)"
  # Race guard: two instances may both have submitted. Keep the lowest id.
  sleep 5
  lowest=$(_chain_others | awk '$2 == "PENDING" {print $1}' | sort -n | head -1)
  if [ -n "$lowest" ] && [ "$lowest" != "$new_id" ] && [ "$lowest" -lt "$new_id" ]; then
    chain_log "duplicate next run detected (job $lowest already queued); cancelling $new_id"
    scancel "$new_id" || true
  fi
  return 0
}
