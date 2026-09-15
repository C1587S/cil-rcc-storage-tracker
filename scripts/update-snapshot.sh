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
# Anchor on gcp_ (a core daily source): out-of-band sources like cds3 are
# published on their own schedule and must not advance the snapshot date.
NEW_DATE=$(curl -sk "${RCC_URL}/" \
  | grep -oP '(?<=href=")gcp_\d{4}-\d{2}-\d{2}_chunk' \
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
  for table in entries directory_hierarchy voronoi_precomputed snapshots directory_recursive_sizes directory_sizes file_type_distribution owner_distribution; do
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

# Step 1b: cds3 (Cost-Effective tier) — scanned on its own schedule from a
# login node. Use the latest COMPLETED cds3 scan for this snapshot:
#  - if today's cds3 files downloaded but its manifest is not completed,
#    drop them (mid-scan publish) and fall back to the newest completed date
#  - if no cds3 files for today, carry forward the newest completed scan
echo ""
echo "--- Step 1b: cds3 carry-forward ---"
CDS3_DIR="${PROJECT_ROOT}/cil_scans/cds3/${NEW_DATE}"
if ls "${CDS3_DIR}"/*.parquet >/dev/null 2>&1 && \
   ! curl -sk "${RCC_URL}/cds3_${NEW_DATE}_manifest.json" | grep -q '"completed": *true'; then
  echo "cds3 files for ${NEW_DATE} are from an unfinished scan — discarding."
  rm -rf "$CDS3_DIR"
fi
if ls "${CDS3_DIR}"/*.parquet >/dev/null 2>&1; then
  echo "cds3 scan for ${NEW_DATE} is complete and downloaded."
else
  CDS3_DATE=""
  for d in $(curl -sk "${RCC_URL}/" \
      | grep -oP '(?<=href=")cds3_\d{4}-\d{2}-\d{2}_manifest\.json' \
      | grep -oP '\d{4}-\d{2}-\d{2}' | sort -ur); do
    if curl -sk "${RCC_URL}/cds3_${d}_manifest.json" | grep -q '"completed": *true'; then
      CDS3_DATE="$d"
      break
    fi
  done
  if [ -z "$CDS3_DATE" ]; then
    echo "No completed cds3 scan published — snapshot will not include /cds3/cil."
  else
    echo "Using completed cds3 scan from ${CDS3_DATE} for snapshot ${NEW_DATE}."
    mkdir -p "$CDS3_DIR"
    CDS3_OK=true
    for f in $(curl -sk "${RCC_URL}/" \
        | grep -oP "(?<=href=\")cds3_${CDS3_DATE}_chunk_[0-9]+\.parquet" | sort -u); do
      echo "  downloading ${f}"
      if ! curl -skf "${RCC_URL}/${f}" -o "${CDS3_DIR}/${f}"; then
        echo "  ERROR downloading ${f}"
        CDS3_OK=false
        break
      fi
    done
    if [ "$CDS3_OK" = false ]; then
      rm -rf "$CDS3_DIR"
      echo "cds3 download failed — continuing without cds3 (main import unaffected)."
    fi
  fi
fi

# Step: Import new snapshot into ClickHouse
echo ""
echo "--- Step 2/3: Import ---"
"${SCRIPT_DIR}/docker-import.sh"

# Step 5: Delete ALL old snapshots from DB and disk (keep only NEW_DATE)
# Safety: a snapshot much smaller than its predecessor means a broken or
# partial import — keep the old data so the dashboard stays usable.
if [ "$KEEP_OLD" = false ]; then
  NEW_COUNT=$(docker compose exec -T clickhouse ${CH_CLIENT} --query \
    "SELECT count() FROM filesystem.entries WHERE snapshot_date='${NEW_DATE}'" 2>/dev/null | tr -d '[:space:]')
  MAX_OLD_COUNT=$(docker compose exec -T clickhouse ${CH_CLIENT} --query \
    "SELECT max(cnt) FROM (SELECT count() AS cnt FROM filesystem.entries WHERE snapshot_date != '${NEW_DATE}' GROUP BY snapshot_date)" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$MAX_OLD_COUNT" ] && [ "$MAX_OLD_COUNT" != "0" ] && [ "${NEW_COUNT:-0}" -lt $((MAX_OLD_COUNT / 2)) ]; then
    echo ""
    echo "WARNING: New snapshot has ${NEW_COUNT:-0} entries vs ${MAX_OLD_COUNT} in the previous one."
    echo "Looks like a partial import — keeping old snapshots (delete skipped)."
    KEEP_OLD=true
  fi
fi
if [ "$KEEP_OLD" = false ]; then
  # Keep the newest previous snapshot (one-day retention: needed by the
  # nightly snapshot_diff job) and delete everything older.
  OLD_DATES=$(docker compose exec -T clickhouse ${CH_CLIENT} --query \
    "SELECT snapshot_date FROM filesystem.snapshots WHERE snapshot_date != '${NEW_DATE}' ORDER BY snapshot_date DESC LIMIT 1000 OFFSET 1" 2>/dev/null | tr -d '\r')

  if [ -n "$OLD_DATES" ]; then
    echo ""
    echo "--- Step 3/3: Delete old snapshots ---"

    while IFS= read -r OLD_DATE; do
      [ -z "$OLD_DATE" ] && continue
      echo "  Removing ${OLD_DATE}..."
      for table in entries directory_hierarchy voronoi_precomputed snapshots directory_recursive_sizes directory_sizes file_type_distribution owner_distribution; do
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

# Pre-warm the API caches so the first visitor doesn't pay the cold scans
echo ""
echo "--- Warming visualization caches ---"
"${SCRIPT_DIR}/warm-cache.sh" || true

# Passive quarantine verification against the fresh snapshot: any batch the
# registry calls "held" whose files the new scan cannot see gets flagged
# loudly here (and in the panel). Same reasoning as execution verification.
echo ""
echo "--- Quarantine reality check ---"
curl -s --compressed http://localhost:8000/api/housekeeping/quarantine \
  | python3 -c "
import json, sys
try:
    groups = json.load(sys.stdin)
except Exception:
    print('  (quarantine check skipped — API unreachable)'); raise SystemExit
flagged = [g for g in groups if g['status'].startswith(('VANISHED', 'partial'))]
for g in flagged:
    print(f\"  WARNING {g['manifest_id']}: {g['status']}\")
if not flagged:
    print(f'  ok — {len(groups)} batch(es) consistent with the snapshot')
" || true

echo ""
echo "======================================================"
echo "Done: dashboard updated to ${NEW_DATE}"
echo "======================================================"
