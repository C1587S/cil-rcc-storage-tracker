#!/bin/bash
# Update dashboard with the latest snapshot from RCC
#
# Usage:
#   ./scripts/update-snapshot.sh            # Download, import, then delete old (default)
#   ./scripts/update-snapshot.sh --keep-old # Keep old snapshots after import
#   ./scripts/update-snapshot.sh --force    # Re-import even if date matches what's in DB
#
# Logs always written to: logs/auto-update.log

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/logs"
LOG_FILE="${LOG_DIR}/auto-update.log"
RCC_URL="https://users.rcc.uchicago.edu/~cadavidsanchez/cil_scans"
LOCK_FILE="/tmp/dev-tracker-update.lock"

KEEP_OLD=false
FORCE=false
for arg in "$@"; do
  [[ "$arg" == "--keep-old" ]] && KEEP_OLD=true
  [[ "$arg" == "--force" ]]    && FORCE=true
done

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  echo "$(date): Another update is already running (lock: $LOCK_FILE). Exiting."
  exit 0
fi
trap "rm -f ${LOCK_FILE}" EXIT
touch "$LOCK_FILE"

# Always tee output to log file
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "======================================================"
echo "Snapshot Update - $(date)"
echo "======================================================"

cd "$PROJECT_ROOT"

# Verify Docker stack is running
if ! docker compose ps clickhouse 2>/dev/null | grep -q "running\|Up"; then
  echo "ERROR: Docker stack is not running. Start it first:"
  echo "  docker compose up -d"
  exit 1
fi

# Step 1: Detect latest published date from RCC
echo "Checking RCC public URL for latest scan..."
NEW_DATE=$(curl -sk "${RCC_URL}/" \
  | grep -oP '(?<=href=")[^"]+_\d{4}-\d{2}-\d{2}_chunk' \
  | grep -oP '\d{4}-\d{2}-\d{2}' \
  | sort -u | tail -1)

if [ -z "$NEW_DATE" ]; then
  echo "ERROR: Could not detect published date from ${RCC_URL}"
  exit 1
fi

# Step 2: Get current snapshot in DB
CURRENT_DATE=$(docker compose exec -T clickhouse clickhouse-client --query \
  "SELECT max(snapshot_date) FROM filesystem.snapshots" 2>/dev/null | tr -d '[:space:]')

echo "Published : ${NEW_DATE}"
echo "In DB     : ${CURRENT_DATE:-none}"

if [ "$NEW_DATE" = "$CURRENT_DATE" ] && [ "$FORCE" = false ]; then
  echo "Already up to date. Nothing to do."
  echo "(Use --force to re-import anyway, e.g. if a newer scan was published today)"
  exit 0
fi

if [ "$FORCE" = true ] && [ "$NEW_DATE" = "$CURRENT_DATE" ]; then
  echo "Forcing re-import of ${NEW_DATE} (--force)"
elif [ "$NEW_DATE" != "$CURRENT_DATE" ]; then
  echo "New snapshot available: ${NEW_DATE}. Starting update..."
fi

# Step 3: Delete existing DB entry for this date if forcing a re-import
if [ "$FORCE" = true ] && [ -n "$CURRENT_DATE" ] && [ "$NEW_DATE" = "$CURRENT_DATE" ]; then
  echo ""
  echo "--- Clearing existing ${NEW_DATE} from DB (--force) ---"
  for table in entries directory_hierarchy voronoi_precomputed snapshots; do
    docker compose exec -T clickhouse clickhouse-client --query \
      "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${NEW_DATE}'"
  done
  docker compose exec -T clickhouse clickhouse-client --query \
    "OPTIMIZE TABLE filesystem.entries FINAL"
  # Also clear parquet files from disk so download-scans.sh re-fetches them
  for source_dir in "${PROJECT_ROOT}/cil_scans"/*/; do
    old_dir="${source_dir%/}/${NEW_DATE}"
    [ -d "$old_dir" ] && rm -rf "$old_dir" && echo "  Cleared disk: $old_dir"
  done
fi

# Step 4 (was 3): Download new files
echo ""
echo "--- Step 1/3: Download ---"
"${PROJECT_ROOT}/scanner/scripts/download-scans.sh" "${RCC_URL}" "${NEW_DATE}"

# Step: Import new snapshot into ClickHouse
echo ""
echo "--- Step 2/3: Import ---"
"${SCRIPT_DIR}/docker-import.sh"

# Step 5: Delete old snapshot from DB and disk
if [ "$KEEP_OLD" = false ] && [ -n "$CURRENT_DATE" ]; then
  echo ""
  echo "--- Step 3/3: Delete old snapshot (${CURRENT_DATE}) ---"

  for table in entries directory_hierarchy voronoi_precomputed snapshots; do
    docker compose exec -T clickhouse clickhouse-client --query \
      "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${CURRENT_DATE}'"
    echo "  Deleted from ${table}"
  done

  docker compose exec -T clickhouse clickhouse-client --query \
    "OPTIMIZE TABLE filesystem.entries FINAL"

  # Clean up old parquet files from disk
  for source_dir in "${PROJECT_ROOT}/cil_scans"/*/; do
    old_dir="${source_dir%/}/${CURRENT_DATE}"
    if [ -d "$old_dir" ]; then
      rm -rf "$old_dir"
      echo "  Removed disk: $old_dir"
    fi
  done

  echo "  Old snapshot ${CURRENT_DATE} removed."
elif [ "$KEEP_OLD" = true ]; then
  echo ""
  echo "--- Step 3/3: Skipped (--keep-old) ---"
fi

echo ""
echo "======================================================"
echo "Done: dashboard updated to ${NEW_DATE}"
echo "======================================================"
