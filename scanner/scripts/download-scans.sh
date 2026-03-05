#!/bin/bash
# Download parquet scan files from RCC public_html and organize for docker-import.sh
#
# Run from the project root:
#   ./scanner/scripts/download-scans.sh
#   ./scanner/scripts/download-scans.sh <url> <date>
#
# Example:
#   ./scanner/scripts/download-scans.sh
#   ./scanner/scripts/download-scans.sh https://users.rcc.uchicago.edu/~cadavidsanchez/cil_scans 2026-03-05

# Resolve project root (two levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

set -e

BASE_URL="${1:-https://users.rcc.uchicago.edu/~cadavidsanchez/cil_scans}"
DATE="${2:-}"

# If no date given, detect from the listing
if [ -z "$DATE" ]; then
  echo "Detecting available dates from ${BASE_URL}..."
  DATE=$(curl -sk "${BASE_URL}/" \
    | grep -oP '(?<=href=")[^"]+_\d{4}-\d{2}-\d{2}_chunk' \
    | grep -oP '\d{4}-\d{2}-\d{2}' \
    | sort -u \
    | tail -1)

  if [ -z "$DATE" ]; then
    echo "Error: Could not detect date from listing. Pass it explicitly."
    echo "Usage: $0 <url> <date>"
    exit 1
  fi
  echo "Detected date: ${DATE}"
fi

echo ""
echo "=========================================="
echo "Downloading CIL scans"
echo "  Source : ${BASE_URL}"
echo "  Date   : ${DATE}"
echo "  Dest   : ${PROJECT_ROOT}/cil_scans/<source>/${DATE}/"
echo "=========================================="
echo ""

# Get full file listing for this date
FILES=$(curl -sk "${BASE_URL}/" \
  | grep -oP "(?<=href=\")[^\"]*_${DATE}_chunk_[0-9]+\.parquet" \
  | sort -u)

if [ -z "$FILES" ]; then
  echo "Error: No parquet files found for date ${DATE} at ${BASE_URL}"
  exit 1
fi

TOTAL=$(echo "$FILES" | wc -l)
echo "Found ${TOTAL} parquet files to download."
echo ""

# Pre-create all destination directories upfront so we catch permission issues early
echo "Creating destination directories..."
UNIQUE_SOURCES=$(echo "$FILES" | sed "s/_${DATE}_chunk_[0-9]*\.parquet//" | sort -u)
for SOURCE in $UNIQUE_SOURCES; do
  DEST_DIR="${PROJECT_ROOT}/cil_scans/${SOURCE}/${DATE}"
  if ! mkdir -p "${DEST_DIR}" 2>/dev/null; then
    echo ""
    echo "ERROR: Cannot create directory: ${DEST_DIR}"
    echo "Fix permissions first:"
    echo "  sudo chown -R $(whoami):$(whoami) ${PROJECT_ROOT}/cil_scans"
    exit 1
  fi
  echo "  [ok] ${DEST_DIR}"
done
echo ""

COUNT=0
SOURCES=()

for FILE in $FILES; do
  # Extract source name: everything before _YYYY-MM-DD_chunk
  SOURCE=$(echo "$FILE" | sed "s/_${DATE}_chunk_[0-9]*\.parquet//")

  DEST_DIR="${PROJECT_ROOT}/cil_scans/${SOURCE}/${DATE}"
  DEST_FILE="${DEST_DIR}/${FILE}"

  # Skip if already downloaded
  if [ -f "${DEST_FILE}" ]; then
    echo "  [skip] ${FILE} (already exists)"
    COUNT=$((COUNT + 1))
    continue
  fi

  HTTP=$(curl -sk -o "${DEST_FILE}" -w "%{http_code}" "${BASE_URL}/${FILE}")

  if [ "$HTTP" = "200" ]; then
    SIZE=$(du -sh "${DEST_FILE}" 2>/dev/null | cut -f1)
    echo "  [ok]   ${FILE} (${SIZE})"
    COUNT=$((COUNT + 1))
    # Track unique sources
    if [[ ! " ${SOURCES[*]} " =~ " ${SOURCE} " ]]; then
      SOURCES+=("$SOURCE")
    fi
  else
    echo "  [fail] ${FILE} (HTTP ${HTTP})"
    rm -f "${DEST_FILE}"
  fi
done

echo ""
echo "=========================================="
echo "Download complete: ${COUNT}/${TOTAL} files"
echo ""
echo "Sources downloaded:"
for s in "${SOURCES[@]}"; do
  COUNT_FILES=$(ls ${PROJECT_ROOT}/cil_scans/${s}/${DATE}/*.parquet 2>/dev/null | wc -l)
  echo "  - ${s}: ${COUNT_FILES} chunks"
done

# Validate all parquet files - delete corrupted ones and re-download
echo ""
echo "Validating parquet files..."
if command -v python3 &>/dev/null; then
  BAD_FILES=$(python3 -c "
import glob, os, sys
try:
    import polars as pl
except ImportError:
    sys.exit(2)
bad = []
for f in sorted(glob.glob('${PROJECT_ROOT}/cil_scans/**/**/*.parquet')):
    try:
        pl.read_parquet(f, n_rows=1)
    except Exception:
        bad.append(f)
        os.remove(f)
for f in bad:
    print(f)
" 2>/dev/null)
  PY_EXIT=$?
  if [ $PY_EXIT -eq 2 ]; then
    echo "  [skip] polars not installed, skipping validation"
  elif [ -z "$BAD_FILES" ]; then
    echo "  [ok] All files are valid"
  else
    BAD_COUNT=$(echo "$BAD_FILES" | wc -l)
    echo "  [warn] ${BAD_COUNT} corrupted file(s) deleted:"
    echo "$BAD_FILES" | sed 's/^/    /'
    echo ""
    echo "  Re-downloading corrupted files..."
    RE_COUNT=0
    while IFS= read -r bad_file; do
      FILE=$(basename "$bad_file")
      SOURCE=$(echo "$FILE" | sed "s/_${DATE}_chunk_[0-9]*\.parquet//")
      DEST_DIR="${PROJECT_ROOT}/cil_scans/${SOURCE}/${DATE}"
      HTTP=$(curl -sk -o "${bad_file}" -w "%{http_code}" "${BASE_URL}/${FILE}")
      if [ "$HTTP" = "200" ]; then
        echo "  [ok]   ${FILE} (re-downloaded)"
        RE_COUNT=$((RE_COUNT + 1))
      else
        echo "  [fail] ${FILE} (HTTP ${HTTP}) - file may not be ready yet on RCC"
        rm -f "${bad_file}"
      fi
    done <<< "$BAD_FILES"
    echo "  Re-downloaded: ${RE_COUNT}/${BAD_COUNT}"
  fi
else
  echo "  [skip] python3 not found, skipping validation"
fi

echo ""
echo "To import into ClickHouse and update the dashboard:"
echo "  cd ${PROJECT_ROOT} && ./scripts/docker-import.sh"
echo "=========================================="
