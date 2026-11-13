#!/bin/bash
# =============================================================================
# restore-check-housekeeping.sh — an untested backup is not a backup.
#
# Weekly (cron: 0 6 * * 1): restores the newest dump into a scratch database
# inside the postgres container, counts rows per table, compares against the
# live database, and fails loudly on mismatch or restore error.
# Prefers the R2 copy when configured (tests the full path back), else the
# newest local dump.
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
LOG="${PROJECT_ROOT}/logs/restore-check.log"
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1
echo "=== restore check $(date '+%F %T') ==="

cd "$PROJECT_ROOT"
ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: env file not found: $ENV_FILE"; exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# --- pick the dump: R2 first (tests the real recovery path), else local ---
DUMP="$BACKUP_DIR/.restore-check.sql"
if [ -n "${R2_ENDPOINT:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
  R2="python3 $PROJECT_ROOT/scripts/r2util.py"
  LATEST_KEY=""
  # "housekeeping-2" = timestamped SQL dumps only. The bare "housekeeping-"
  # prefix also matches housekeeping-archive-*/housekeeping-ledger-*, which
  # sort after the dumps and would be picked as the "latest dump".
  for PREFIX in hourly daily monthly; do
    LATEST_KEY=$($R2 latest "$PREFIX/housekeeping-2" 2>/dev/null) && [ -n "$LATEST_KEY" ] && break
  done
  if [ -z "$LATEST_KEY" ]; then
    echo "FAIL: R2 configured but no dump found under hourly/, daily/ or monthly/"; exit 1
  fi
  echo "Pulling from R2: $LATEST_KEY"
  $R2 get "$LATEST_KEY" "$DUMP"
else
  LOCAL=$(ls -t "$BACKUP_DIR"/housekeeping-2*.sql 2>/dev/null | head -1)
  if [ -z "$LOCAL" ]; then
    echo "FAIL: no dump found (local or R2)"; exit 1
  fi
  echo "Using local dump: $LOCAL (R2 not configured)"
  cp "$LOCAL" "$DUMP"
  LATEST_KEY="$LOCAL"
fi

# --- freshness: backups run hourly, so the newest dump must be recent ---
MAX_AGE_HOURS="${MAX_DUMP_AGE_HOURS:-26}"
STAMP=$(basename "$LATEST_KEY" | grep -oE '[0-9]{8}-[0-9]{6}' | head -1 || true)
if [ -z "$STAMP" ]; then
  echo "FAIL: cannot read a timestamp from dump name '$LATEST_KEY'"; rm -f "$DUMP"; exit 1
fi
DUMP_EPOCH=$(date -d "${STAMP:0:8} ${STAMP:9:2}:${STAMP:11:2}:${STAMP:13:2}" +%s)
AGE_HOURS=$(( ($(date +%s) - DUMP_EPOCH) / 3600 ))
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  echo "FAIL: newest dump is ${AGE_HOURS}h old (limit ${MAX_AGE_HOURS}h) — backups have stopped"
  rm -f "$DUMP"; exit 1
fi
echo "Dump age: ${AGE_HOURS}h"

# --- restore into a scratch database ---
docker compose exec -T postgres psql -U housekeeping -d postgres -q -c \
  "DROP DATABASE IF EXISTS hk_restore_check" -c "CREATE DATABASE hk_restore_check"
docker compose exec -T postgres psql -U housekeeping -d hk_restore_check -q \
  -v ON_ERROR_STOP=1 < "$DUMP" > /dev/null

# --- count and compare ---
FAIL=0
for T in person target assignment decision execution event; do
  LIVE=$(docker compose exec -T postgres psql -U housekeeping -d housekeeping -tAc "SELECT count(*) FROM $T" | tr -d '[:space:]')
  REST=$(docker compose exec -T postgres psql -U housekeeping -d hk_restore_check -tAc "SELECT count(*) FROM $T" | tr -d '[:space:]')
  # restored count may lag live (dump is older) but must never exceed it,
  # and must parse as a number
  if ! [ "$REST" -ge 0 ] 2>/dev/null; then
    echo "FAIL: $T — restored count unreadable ('$REST')"; FAIL=1
  elif [ "$REST" -gt "$LIVE" ]; then
    echo "FAIL: $T — restored $REST > live $LIVE (wrong dump?)"; FAIL=1
  elif [ "$REST" -eq 0 ] && [ "$LIVE" -gt 0 ]; then
    echo "FAIL: $T — restored 0 rows but live has $LIVE (empty or wrong dump)"; FAIL=1
  else
    echo "ok:   $T — restored $REST (live $LIVE)"
  fi
done

docker compose exec -T postgres psql -U housekeeping -d postgres -q -c \
  "DROP DATABASE IF EXISTS hk_restore_check"
rm -f "$DUMP"

if [ "$FAIL" = 1 ]; then
  echo "RESTORE CHECK FAILED — the backup may not be restorable"; exit 1
fi
echo "Restore check passed."
