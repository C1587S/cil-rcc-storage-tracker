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

# Load ClickHouse password from .env
if [ -f "${PROJECT_ROOT}/.env" ]; then
  CH_PASS=$(grep '^CLICKHOUSE_PASSWORD=' "${PROJECT_ROOT}/.env" | cut -d= -f2-)
fi
CH_PASS="${CH_PASS:-}"
CH_CLIENT="clickhouse-client --password ${CH_PASS}"

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
CURRENT_DATE=$(docker compose exec -T clickhouse ${CH_CLIENT} --query \
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
    docker compose exec -T clickhouse ${CH_CLIENT} --query \
      "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${NEW_DATE}'"
  done
  docker compose exec -T clickhouse ${CH_CLIENT} --query \
    "OPTIMIZE TABLE filesystem.entries FINAL"
  # Also clear parquet files from disk so download-scans.sh re-fetches them
  for source_dir in "${PROJECT_ROOT}/cil_scans"/*/; do
    old_dir="${source_dir%/}/${NEW_DATE}"
    [ -d "$old_dir" ] && rm -rf "$old_dir" && echo "  Cleared disk: $old_dir"
  done
fi

# Step 4 (was 3): Download new files (with retries at pipeline level)
echo ""
echo "--- Step 1/3: Download ---"
DOWNLOAD_OK=false
for dl_attempt in 1 2 3; do
  if "${PROJECT_ROOT}/scanner/scripts/download-scans.sh" "${RCC_URL}" "${NEW_DATE}"; then
    DOWNLOAD_OK=true
    break
  else
    if [ $dl_attempt -lt 3 ]; then
      echo ""
      echo "Download attempt ${dl_attempt}/3 failed. Retrying in 60 seconds..."
      sleep 60
    fi
  fi
done

if [ "$DOWNLOAD_OK" = false ]; then
  echo "ERROR: Download failed after 3 attempts. Import skipped."
  exit 1
fi

# Step: Import new snapshot into ClickHouse
echo ""
echo "--- Step 2/3: Import ---"
"${SCRIPT_DIR}/docker-import.sh"

# Step 5: Delete ALL old snapshots from DB and disk (keep only NEW_DATE)
if [ "$KEEP_OLD" = false ]; then
  # Get all snapshot dates except the one we just imported
  OLD_DATES=$(docker compose exec -T clickhouse ${CH_CLIENT} --query \
    "SELECT snapshot_date FROM filesystem.snapshots WHERE snapshot_date != '${NEW_DATE}' ORDER BY snapshot_date" 2>/dev/null | tr -d '\r')

  if [ -n "$OLD_DATES" ]; then
    echo ""
    echo "--- Step 3/3: Delete old snapshots ---"

    while IFS= read -r OLD_DATE; do
      [ -z "$OLD_DATE" ] && continue
      echo "  Removing ${OLD_DATE}..."
      for table in entries directory_hierarchy voronoi_precomputed snapshots; do
        docker compose exec -T clickhouse ${CH_CLIENT} --query \
          "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${OLD_DATE}'"
      done

      # Clean up old parquet files from disk
      for source_dir in "${PROJECT_ROOT}/cil_scans"/*/; do
        old_dir="${source_dir%/}/${OLD_DATE}"
        [ -d "$old_dir" ] && rm -rf "$old_dir" && echo "    Removed disk: $old_dir"
      done
    done <<< "$OLD_DATES"

    docker compose exec -T clickhouse ${CH_CLIENT} --query \
      "OPTIMIZE TABLE filesystem.entries FINAL"

    echo "  All old snapshots removed. Only ${NEW_DATE} remains."
  else
    echo ""
    echo "--- Step 3/3: No old snapshots to remove ---"
  fi
elif [ "$KEEP_OLD" = true ]; then
  echo ""
  echo "--- Step 3/3: Skipped (--keep-old) ---"
fi

echo ""
echo "======================================================"
echo "Done: dashboard updated to ${NEW_DATE}"
echo "======================================================"
