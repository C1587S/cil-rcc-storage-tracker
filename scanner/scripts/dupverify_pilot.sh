#!/bin/bash
#SBATCH --job-name=cil_dupverify
#SBATCH --account=cil
#SBATCH --partition=cil
#SBATCH --cpus-per-task=4
#SBATCH --ntasks=1
#SBATCH --mem=4G
#SBATCH --time=04:00:00
#SBATCH --signal=B:TERM@300
#SBATCH --mail-type=END,FAIL,TIME_LIMIT
#SBATCH -o ./slurm_out/dupverify_%j.out
#SBATCH -e ./slurm_out/dupverify_%j.err
# =============================================================================
# dupverify_pilot.sh — one explicitly requested, read-only content
# verification run over an exported candidate file. NOT part of any chain:
# it does not resubmit itself and nothing schedules it.
#
# Reads candidate files only (O_RDONLY | O_NOFOLLOW, O_NOATIME when owned);
# never modifies, moves or deletes anything. Stops cleanly at the I/O
# budget or ~5 min before the time limit (SIGTERM); resubmitting with the
# same OUT continues where it stopped.
#
# Required:
#   CANDIDATES   candidate JSONL from scripts/dupverify/export_candidates.py
#                (contains real paths: keep it mode 0600, outside the repo)
# Optional (defaults are the pilot's limits):
#   OUT                   output dir          (default: $HOME/dupverify/<basename of CANDIDATES>)
#   DUPV_BUDGET_GIB       total bytes to read (default: 200)
#   DUPV_MAX_READ_MIB_S   sustained read cap  (default: 200)
#   DUPV_WORKERS          concurrent files    (default: 4)
#   DUPV_PREFIX           only files under this directory
#   DUPV_EXTRA            extra flags, e.g. "--byte-verify"
#
#   sbatch --export=ALL,CANDIDATES=$HOME/dupverify/cand_pilot.jsonl \
#          scanner/scripts/dupverify_pilot.sh
# =============================================================================
set -euo pipefail
umask 077

: "${CANDIDATES:?set CANDIDATES to the exported candidate JSONL}"
[ -r "$CANDIDATES" ] || { echo "cannot read CANDIDATES" >&2; exit 2; }
REPO="${SLURM_SUBMIT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BIN="$REPO/scanner/target/release/cil-dupverify"
[ -x "$BIN" ] || { echo "build first: (cd scanner && cargo build --release -p dupverify)" >&2; exit 2; }
OUT="${OUT:-$HOME/dupverify/$(basename "$CANDIDATES" .jsonl)}"
mkdir -p "$OUT"

ARGS=(--input "$CANDIDATES" --out "$OUT"
      --workers "${DUPV_WORKERS:-4}"
      --max-read-mib-s "${DUPV_MAX_READ_MIB_S:-200}"
      --budget-gib "${DUPV_BUDGET_GIB:-200}")
[ -n "${DUPV_PREFIX:-}" ] && ARGS+=(--prefix "$DUPV_PREFIX")
# shellcheck disable=SC2206
[ -n "${DUPV_EXTRA:-}" ] && ARGS+=($DUPV_EXTRA)

echo "cil-dupverify job ${SLURM_JOB_ID:-local} on $(hostname) at $(date -u +%FT%TZ)"
echo "workers=${DUPV_WORKERS:-4} rate=${DUPV_MAX_READ_MIB_S:-200}MiB/s budget=${DUPV_BUDGET_GIB:-200}GiB"
"$BIN" --input "$CANDIDATES" --plan | sed 's/^/plan: /'
# exec: the batch shell becomes the verifier, so --signal=B:TERM reaches it.
# Exit 3 = stopped at budget or time limit; resubmit with the same OUT to continue.
exec "$BIN" "${ARGS[@]}"
