#!/bin/bash
# =============================================================================
# scan_cds3_login.sh - Scan /cds3/cil from a LOGIN node
#
# /cds3 (Cost-Effective tier, Ceph) is not mounted on compute nodes, so this
# scan cannot run through Slurm like the others. Run it on a Midway3 login
# node instead. It is metadata-only (stat calls), uses few threads to stay
# polite on a shared node, and resumes automatically if interrupted.
#
# Usage (Midway3 login node):
#   nohup bash scanner/scripts/scan_cds3_login.sh > ~/cds3_scan.log 2>&1 &
#
# Then publish from Midway2 with:
#   bash scanner/scripts/publish_append.sh cds3
#
# cds3 is a cold archive: weekly or monthly cadence is enough.
# If the process is killed (login-node limits), rerun: --resume continues.
# =============================================================================
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCANNER_BIN="${REPO_ROOT}/scanner/target/release/storage-scanner"
SCAN_PATH="/cds3/cil"
OUTPUT_DIR="/scratch/midway3/${USER}/cil_scans"
DATE=$(date +%Y-%m-%d)
LOCK_FILE="/tmp/cds3_scan_${USER}.lock"

# Refuse to run twice concurrently: overlapping scans write duplicate chunks,
# which poisons the import with duplicated entries.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "Another cds3 scan is already running (lock: $LOCK_FILE). Exiting."
    exit 1
fi

if [ ! -f "$SCANNER_BIN" ]; then
    echo "ERROR: scanner binary not found at $SCANNER_BIN"
    echo "Build it first: cd scanner && cargo build --release"
    exit 1
fi

if [ ! -d "$SCAN_PATH" ]; then
    echo "ERROR: $SCAN_PATH not accessible from this node."
    echo "Run this on a Midway3 LOGIN node (compute nodes do not mount /cds3)."
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "================================================"
echo "cds3 login-node scan"
echo "  Path   : $SCAN_PATH"
echo "  Output : $OUTPUT_DIR/cds3_${DATE}_chunk_*.parquet"
echo "  Start  : $(date)"
echo "================================================"

"$SCANNER_BIN" scan \
    --path "$SCAN_PATH" \
    --output "$OUTPUT_DIR/cds3_${DATE}.parquet" \
    --threads 4 \
    --batch-size 50000 \
    --incremental \
    --resume

EXIT_CODE=$?
echo "================================================"
echo "cds3 scan finished with exit code $EXIT_CODE at $(date)"
if [ $EXIT_CODE -eq 0 ]; then
    ls "$OUTPUT_DIR"/cds3_${DATE}_chunk_*.parquet 2>/dev/null | wc -l | xargs echo "  Chunks:"
    echo ""
    echo "Next: publish from Midway2 with:"
    echo "  bash scanner/scripts/publish_append.sh cds3"
fi
echo "================================================"
exit $EXIT_CODE
