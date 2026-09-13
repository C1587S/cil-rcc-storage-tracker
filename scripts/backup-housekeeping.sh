#!/bin/bash
# =============================================================================
# backup-housekeeping.sh — durable backup of the ONLY irreplaceable data
#
# Postgres (decisions, assignments, event log) is human work that exists
# nowhere else; daily_rollup in ClickHouse is permanent history that rides
# this same backup ("ClickHouse is disposable EXCEPT daily_rollup").
#
# Object keys are prefixed to match the bucket's lifecycle rules:
#   hourly/   every run              (bucket expires these after 7 days)
#   daily/    first run of each day  (expires after 90 days)
#   monthly/  first run of each month (kept indefinitely — this prefix must
#             NEVER gain an expiry rule)
#
# Every upload is verified with a HEAD on the key just written; a zero exit
# from the uploader is not treated as proof.
#
# Env (in <repo>/.env, loaded explicitly — never relies on the shell):
#   R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
#   R2_BUCKET=cil-housekeeping-backups
#   R2_ACCESS_KEY_ID=...
#   R2_SECRET_ACCESS_KEY=...
#
# Cron: 0 * * * *  (hourly). Concurrency-safe via flock + temp-then-rename.
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups"
LOCK_FILE="${BACKUP_DIR}/.dump.lock"
ENV_FILE="${PROJECT_ROOT}/.env"
STAMP=$(date +%Y%m%d-%H%M%S)
TODAY=$(date +%Y%m%d)
MONTH=$(date +%Y%m)
QUIET=false
[ "$1" = "--quiet" ] && QUIET=true

log() { [ "$QUIET" = false ] && echo "$(date '+%F %T') $*"; }

cd "$PROJECT_ROOT"
mkdir -p "$BACKUP_DIR"

# --- 0. Environment: loaded explicitly, independent of the caller's shell ---
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: env file not found: $ENV_FILE"
    echo "The backup cannot read database or R2 credentials without it."
    exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# --- 1. Postgres dump (flock-serialized with the API's on-write dumps) ---
log "Dumping Postgres..."
flock "$LOCK_FILE" bash -c "
  docker compose exec -T postgres pg_dump -U housekeeping -d housekeeping \
    > '$BACKUP_DIR/housekeeping-$STAMP.sql.tmp' &&
  mv '$BACKUP_DIR/housekeeping-$STAMP.sql.tmp' '$BACKUP_DIR/housekeeping-$STAMP.sql'
"
PG_DUMP_FILE="$BACKUP_DIR/housekeeping-$STAMP.sql"

# --- 2. daily_rollup CSV (permanent history — not disposable) ---
log "Dumping daily_rollup..."
docker compose exec -T clickhouse clickhouse-client --password "${CLICKHOUSE_PASSWORD:-}" \
  --query "SELECT * FROM filesystem.daily_rollup FINAL FORMAT CSVWithNames" \
  > "$BACKUP_DIR/daily_rollup-$STAMP.csv.tmp"
mv "$BACKUP_DIR/daily_rollup-$STAMP.csv.tmp" "$BACKUP_DIR/daily_rollup-$STAMP.csv"
ROLLUP_FILE="$BACKUP_DIR/daily_rollup-$STAMP.csv"

# --- 2b. Human-readable record: the archive must outlive the app.
# JSON = complete structured record; CSV = flat chronological ledger.
log "Exporting the record..."
if curl -sf --compressed "http://localhost:8000/api/housekeeping/archive.json" \
     -o "$BACKUP_DIR/housekeeping-archive-$STAMP.json.tmp" &&
   curl -sf "http://localhost:8000/api/housekeeping/archive.csv" \
     -o "$BACKUP_DIR/housekeeping-ledger-$STAMP.csv.tmp"; then
  mv "$BACKUP_DIR/housekeeping-archive-$STAMP.json.tmp" "$BACKUP_DIR/housekeeping-archive-$STAMP.json"
  mv "$BACKUP_DIR/housekeeping-ledger-$STAMP.csv.tmp" "$BACKUP_DIR/housekeeping-ledger-$STAMP.csv"
  ARCHIVE_FILE="$BACKUP_DIR/housekeeping-archive-$STAMP.json"
  LEDGER_FILE="$BACKUP_DIR/housekeeping-ledger-$STAMP.csv"
else
  log "WARNING: record export failed (API down?) — dumps still cover the data."
  ARCHIVE_FILE=""
  LEDGER_FILE=""
fi

# --- 3. Ship to R2 under lifecycle-matched prefixes, verifying each key ---
if [ -n "${R2_ENDPOINT:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
    R2="python3 ${SCRIPT_DIR}/r2util.py"

    upload_pair() {
        local prefix="$1"
        log "Uploading to ${prefix}..."
        $R2 put "$PG_DUMP_FILE" "${prefix}/housekeeping-$STAMP.sql"
        $R2 put "$ROLLUP_FILE" "${prefix}/daily_rollup-$STAMP.csv"
        [ -n "$ARCHIVE_FILE" ] && $R2 put "$ARCHIVE_FILE" "${prefix}/housekeeping-archive-$STAMP.json"
        [ -n "$LEDGER_FILE" ] && $R2 put "$LEDGER_FILE" "${prefix}/housekeeping-ledger-$STAMP.csv"
    }

    upload_pair "hourly"

    # Promote the first run of the day / month. Objects meant to live longer
    # never sit under a prefix with a shorter expiry.
    if ! $R2 exists "daily/housekeeping-${TODAY}" >/dev/null 2>&1; then
        upload_pair "daily"
    fi
    if ! $R2 exists "monthly/housekeeping-${MONTH}" >/dev/null 2>&1; then
        upload_pair "monthly"
    fi
else
    log "WARNING: R2 not configured (R2_ENDPOINT/R2_BUCKET unset in $ENV_FILE) — backup is LOCAL ONLY."
fi

# --- 4. Local retention: keep 7 days of hourly dumps ---
find "$BACKUP_DIR" -name "housekeeping-2*.sql" -mtime +7 -delete
find "$BACKUP_DIR" -name "daily_rollup-2*.csv" -mtime +7 -delete
find "$BACKUP_DIR" -name "housekeeping-archive-2*.json" -mtime +7 -delete
find "$BACKUP_DIR" -name "housekeeping-ledger-2*.csv" -mtime +7 -delete

log "Done."
