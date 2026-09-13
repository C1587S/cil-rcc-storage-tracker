#!/bin/bash
# =============================================================================
# backup-housekeeping.sh — durable backup of the ONLY irreplaceable data
#
# Postgres (decisions, assignments, event log) is human work that exists
# nowhere else; daily_rollup in ClickHouse is permanent history that rides
# this same backup ("ClickHouse is disposable EXCEPT daily_rollup").
#
# Layers:
#   - The API also dumps on every state change (dump-on-write, same lock).
#   - This script: full timestamped dump + daily_rollup CSV, then upload to
#     S3-compatible object storage (Cloudflare R2) when configured.
#   - Run hourly from cron:  0 * * * *  /path/to/backup-housekeeping.sh
#
# Concurrency-safe: flock serializes against the API's on-write dumps and
# overlapping cron runs; everything is written to a temp name and renamed.
#
# R2 config (optional, in .env):
#   R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
#   R2_BUCKET=cil-housekeeping-backups
#   R2_ACCESS_KEY_ID=... / R2_SECRET_ACCESS_KEY=...
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
LOCK_FILE="${BACKUP_DIR}/.dump.lock"
STAMP=$(date +%Y%m%d-%H%M%S)
QUIET=false
[ "$1" = "--quiet" ] && QUIET=true

log() { [ "$QUIET" = false ] && echo "$(date '+%F %T') $*"; }

cd "$PROJECT_ROOT"
mkdir -p "$BACKUP_DIR"

# Load env for passwords and R2 credentials
[ -f .env ] && set -a && . ./.env && set +a

# --- 1. Postgres dump (flock-serialized with the API's on-write dumps) ---
log "Dumping Postgres..."
flock "$LOCK_FILE" bash -c "
  docker compose exec -T postgres pg_dump -U housekeeping -d housekeeping \
    > '$BACKUP_DIR/housekeeping-$STAMP.sql.tmp' &&
  mv '$BACKUP_DIR/housekeeping-$STAMP.sql.tmp' '$BACKUP_DIR/housekeeping-$STAMP.sql'
"
ln -sf "housekeeping-$STAMP.sql" "$BACKUP_DIR/housekeeping-latest-hourly.sql"

# --- 2. daily_rollup CSV (permanent history — not disposable) ---
log "Dumping daily_rollup..."
docker compose exec -T clickhouse clickhouse-client --password "${CLICKHOUSE_PASSWORD:-}" \
  --query "SELECT * FROM filesystem.daily_rollup FINAL FORMAT CSVWithNames" \
  > "$BACKUP_DIR/daily_rollup-$STAMP.csv.tmp"
mv "$BACKUP_DIR/daily_rollup-$STAMP.csv.tmp" "$BACKUP_DIR/daily_rollup-$STAMP.csv"
ln -sf "daily_rollup-$STAMP.csv" "$BACKUP_DIR/daily_rollup-latest.csv"

# --- 3. Ship to object storage (R2) when configured ---
if [ -n "${R2_ENDPOINT:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
  log "Uploading to R2..."
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors \
    "$BACKUP_DIR/housekeeping-$STAMP.sql" "s3://$R2_BUCKET/postgres/housekeeping-$STAMP.sql"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors \
    "$BACKUP_DIR/daily_rollup-$STAMP.csv" "s3://$R2_BUCKET/rollup/daily_rollup-$STAMP.csv"
else
  log "WARNING: R2 not configured (R2_ENDPOINT/R2_BUCKET unset) — backup is LOCAL ONLY."
fi

# --- 4. Local retention: keep 7 days of hourly dumps ---
find "$BACKUP_DIR" -name "housekeeping-2*.sql" -mtime +7 -delete
find "$BACKUP_DIR" -name "daily_rollup-2*.csv" -mtime +7 -delete

log "Done."
