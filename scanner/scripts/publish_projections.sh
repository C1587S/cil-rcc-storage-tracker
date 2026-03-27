#!/bin/bash
# =============================================================================
# publish_projections.sh - Scan + publish projection monitor reports
# Runs on Midway2 (public_html HTTP access).
#
# 1. Runs pi-mgreenst_scan_computing.sh locally to generate a fresh report
# 2. Falls back to latest scan from shared scratch (Midway3) if local scan fails
# 3. Publishes to ~/public_html/cil_scans/projections/
# 4. Keeps only the N most recent reports
#
# Usage:
#   bash publish_projections.sh
#   bash publish_projections.sh --keep 50
#   bash publish_projections.sh --scan-only   # just run the scan, don't publish
# =============================================================================
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_SCRIPT="${SCRIPT_DIR}/pi-mgreenst_scan_computing.sh"
SCRATCH_DIR="${SCRATCH_DIR:-/scratch/midway3/${USER}/cil_scans/projections}"
LOCAL_SCAN_DIR="${LOCAL_SCAN_DIR:-/scratch/midway2/${USER}/cil_scans/projections}"
PUBLISH_DIR="${PUBLISH_DIR:-${HOME}/public_html/cil_scans/projections}"
PUBLIC_URL="http://users.rcc.uchicago.edu/~${USER}/cil_scans/projections"
KEEP=50
DEBUG=0
SCAN_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --keep)        KEEP="$2";       shift 2 ;;
        --scan-dir)    SCRATCH_DIR="$2"; shift 2 ;;
        --publish-dir) PUBLISH_DIR="$2"; shift 2 ;;
        --scan-only)   SCAN_ONLY=true;  shift ;;
        --debug)       DEBUG=1;         shift ;;
        *) shift ;;
    esac
done

decho() { [[ "$DEBUG" -eq 1 ]] && echo "[DEBUG] $*" >&2; }

# =============================================================================
# Step 1: Run the scan locally to produce a fresh report
# =============================================================================
LATEST_SCAN=""

if [[ -f "$SCAN_SCRIPT" ]]; then
    echo "Running projection scan locally..."
    mkdir -p "$LOCAL_SCAN_DIR"
    SCAN_PATH=$(bash "$SCAN_SCRIPT" --json --outdir "$LOCAL_SCAN_DIR" 2>/dev/null)
    if [[ -n "$SCAN_PATH" && -f "$SCAN_PATH" ]]; then
        echo "Scan completed: $(basename "$SCAN_PATH")"
        LATEST_SCAN="$SCAN_PATH"
    else
        echo "Warning: local scan failed or produced no output."
    fi
else
    echo "Warning: scan script not found at $SCAN_SCRIPT"
fi

# =============================================================================
# Step 2: Fall back to latest scan from shared scratch (Midway3) if needed
# =============================================================================
if [[ -z "$LATEST_SCAN" && -d "$SCRATCH_DIR" ]]; then
    echo "Checking shared scratch for recent scan..."
    LATEST_SCAN=$(ls -t "$SCRATCH_DIR"/projection_status_*.json 2>/dev/null | head -1)
    if [[ -n "$LATEST_SCAN" ]]; then
        scan_age=$(( $(date +%s) - $(stat -c %Y "$LATEST_SCAN" 2>/dev/null || echo 0) ))
        echo "Using scratch scan: $(basename "$LATEST_SCAN") (${scan_age}s ago)"
        if [[ "$scan_age" -gt 1800 ]]; then
            echo "Warning: scan is ${scan_age}s old"
        fi
    fi
fi

if [[ -z "$LATEST_SCAN" || ! -f "$LATEST_SCAN" ]]; then
    echo "Error: no scan data available (local scan failed, no scratch scan found)"
    exit 1
fi

if [[ "$SCAN_ONLY" = true ]]; then
    echo "Scan-only mode. Report at: $LATEST_SCAN"
    exit 0
fi

# =============================================================================
# Step 3: Publish to public_html
# =============================================================================
# Check we are on Midway2 (only needed for publish, not scan)
if [[ "$(hostname)" != *"midway2"* ]]; then
    echo "Warning: not on Midway2 — skipping publish (public_html only served there)."
    echo "Report at: $LATEST_SCAN"
    exit 0
fi

echo "Publishing to $PUBLISH_DIR..."

mkdir -p "$PUBLISH_DIR"
chmod o+x "$HOME" 2>/dev/null
chmod o+x "$HOME/public_html" 2>/dev/null
chmod o+x "$HOME/public_html/cil_scans" 2>/dev/null
chmod o+x "$PUBLISH_DIR" 2>/dev/null
chmod o+r "$PUBLISH_DIR" 2>/dev/null

# Copy with timestamped name
REPORT_ID=$(date '+%Y%m%d-%H%M%S')
REPORT_FILE="projection_${REPORT_ID}.json"
cp "$LATEST_SCAN" "$PUBLISH_DIR/$REPORT_FILE"

# Copy as latest.json
cp "$PUBLISH_DIR/$REPORT_FILE" "$PUBLISH_DIR/latest.json"
chmod -R o+r "$PUBLISH_DIR"

# Generate index.json
python3 -c "
import json, os, glob
from datetime import datetime

pub_dir = '${PUBLISH_DIR}'
reports = []
for f in sorted(glob.glob(os.path.join(pub_dir, 'projection_*.json')), reverse=True):
    fname = os.path.basename(f)
    mtime = os.path.getmtime(f)
    reports.append({
        'filename': fname,
        'published_at': datetime.fromtimestamp(mtime).astimezone().isoformat(),
        'is_latest': (len(reports) == 0)
    })

index = {
    'generated_at': datetime.now().astimezone().isoformat(),
    'count': len(reports),
    'reports': reports
}

with open(os.path.join(pub_dir, 'index.json'), 'w') as f:
    json.dump(index, f, indent=2)
"
chmod o+r "$PUBLISH_DIR/index.json"

# =============================================================================
# Step 4: Prune old reports
# =============================================================================
REPORT_COUNT=$(ls -1 "$PUBLISH_DIR"/projection_*.json 2>/dev/null | wc -l)
if [[ "$REPORT_COUNT" -gt "$KEEP" ]]; then
    TO_DELETE=$((REPORT_COUNT - KEEP))
    echo "Pruning $TO_DELETE old reports (keeping $KEEP)..."
    ls -1t "$PUBLISH_DIR"/projection_*.json | tail -n "$TO_DELETE" | xargs rm -f
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "Published: $PUBLISH_DIR/$REPORT_FILE"
echo "Latest:    $PUBLISH_DIR/latest.json"
echo "URL:       $PUBLIC_URL/latest.json"
echo "Reports:   $(ls -1 "$PUBLISH_DIR"/projection_*.json 2>/dev/null | wc -l) / $KEEP"
echo ""
