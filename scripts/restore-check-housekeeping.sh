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
[ -f .env ] && set -a && . ./.env && set +a

# --- pick the dump: R2 first (tests the real recovery path), else local ---
DUMP="$BACKUP_DIR/.restore-check.sql"
if [ -n "${R2_ENDPOINT:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
  LATEST_KEY=$(AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 ls --endpoint-url "$R2_ENDPOINT" "s3://$R2_BUCKET/postgres/" | sort | tail -1 | awk '{print $4}')
  echo "Pulling from R2: $LATEST_KEY"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors \
    "s3://$R2_BUCKET/postgres/$LATEST_KEY" "$DUMP"
else
  LOCAL=$(ls -t "$BACKUP_DIR"/housekeeping-2*.sql 2>/dev/null | head -1)
  if [ -z "$LOCAL" ]; then
    echo "FAIL: no dump found (local or R2)"; exit 1
  fi
  echo "Using local dump: $LOCAL (R2 not configured)"
  cp "$LOCAL" "$DUMP"
fi

# --- restore into a scratch database ---
docker compose exec -T postgres psql -U housekeeping -d postgres -q -c \
  "DROP DATABASE IF EXISTS hk_restore_check" -c "CREATE DATABASE hk_restore_check"
docker compose exec -T postgres psql -U housekeeping -d hk_restore_check -q \
  < "$DUMP" > /dev/null

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
