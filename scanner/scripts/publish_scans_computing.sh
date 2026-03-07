#!/bin/bash
# =============================================================================
# cil_publish.sh - Merge and publish CIL scan reports
# Runs on Midway2 ONLY (public_html HTTP access).
#
# 1. Runs cil_scan.sh --json locally for Midway2 data
# 2. Picks up latest Midway3 scan from shared scratch
# 3. Merges both into a combined report
# 4. Publishes to ~/public_html/cil_scans/quotas/
# 5. Keeps only the N most recent reports
#
# Usage:
#   bash cil_publish.sh
#   bash cil_publish.sh --keep 20
#   bash cil_publish.sh --clean
# =============================================================================
set -o pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_SCRIPT="${SCRIPT_DIR}/cil_scan_computing.sh"
ACCOUNT="${CIL_ACCOUNT:-cil}"

MIDWAY2_SCAN_DIR="${MIDWAY2_SCAN_DIR:-/scratch/midway2/${USER}/cil_scans}"
MIDWAY3_SCAN_DIR="${MIDWAY3_SCAN_DIR:-/scratch/midway3/${USER}/cil_scans}"
PUBLISH_DIR="${PUBLISH_DIR:-${HOME}/public_html/cil_scans/quotas}"
PUBLIC_URL="http://users.rcc.uchicago.edu/~${USER}/cil_scans/quotas"

KEEP=10
CLEAN=false
DEBUG=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep)    KEEP="$2";  shift 2 ;;
        --clean)   CLEAN=true; shift   ;;
        --debug)   DEBUG=1;    shift   ;;
        --midway3-source) MIDWAY3_SCAN_DIR="$2"; shift 2 ;;
        --publish-dir)    PUBLISH_DIR="$2";       shift 2 ;;
        *) shift ;;
    esac
done

decho() { [[ "$DEBUG" -eq 1 ]] && echo "[DEBUG] $*" >&2; }

# Check we are on Midway2
if [[ "$(hostname)" != *"midway2"* ]]; then
    echo "Error: this script must run from Midway2 (public_html is only served there)."
    echo "Current host: $(hostname)"
    exit 1
fi

# Check scan script exists
if [[ ! -f "$SCAN_SCRIPT" ]]; then
    echo "Error: scan script not found at $SCAN_SCRIPT"
    exit 1
fi

# =============================================================================
# Step 1: Run local Midway2 scan
# =============================================================================
echo "Running Midway2 scan..."
mkdir -p "$MIDWAY2_SCAN_DIR"
M2_SCAN_PATH=$(bash "$SCAN_SCRIPT" --json --outdir "$MIDWAY2_SCAN_DIR" -a "$ACCOUNT")
if [[ -z "$M2_SCAN_PATH" || ! -f "$M2_SCAN_PATH" ]]; then
    echo "Warning: Midway2 scan failed or produced no output."
    M2_SCAN_PATH=""
fi
decho "Midway2 scan: $M2_SCAN_PATH"

# =============================================================================
# Step 2: Find latest Midway3 scan from shared scratch
# =============================================================================
M3_SCAN_PATH=""
if [[ -d "$MIDWAY3_SCAN_DIR" ]]; then
    M3_SCAN_PATH=$(ls -t "$MIDWAY3_SCAN_DIR"/scan_midway3_*.json 2>/dev/null | head -1)
    if [[ -n "$M3_SCAN_PATH" ]]; then
        # Check it's not too old (>30 min = 1800 sec)
        scan_age=$(( $(date +%s) - $(stat -c %Y "$M3_SCAN_PATH" 2>/dev/null || echo 0) ))
        if [[ "$scan_age" -gt 1800 ]]; then
            echo "Warning: latest Midway3 scan is ${scan_age}s old ($(basename "$M3_SCAN_PATH"))"
        fi
    fi
fi
decho "Midway3 scan: ${M3_SCAN_PATH:-not found}"

# =============================================================================
# Step 3: Merge into combined report
# =============================================================================
REPORT_ID=$(date '+%Y%m%d-%H%M%S')
REPORT_FILE="report_${REPORT_ID}.json"

echo "Merging reports..."
python3 -c "
import json, sys, os
from datetime import datetime

m2_path = '${M2_SCAN_PATH}'
m3_path = '${M3_SCAN_PATH}'

m2 = None
m3 = None

if m2_path and os.path.isfile(m2_path):
    try:
        with open(m2_path) as f:
            m2 = json.load(f)
    except Exception as e:
        print(f'Warning: failed to load Midway2 scan: {e}', file=sys.stderr)

if m3_path and os.path.isfile(m3_path):
    try:
        with open(m3_path) as f:
            m3 = json.load(f)
    except Exception as e:
        print(f'Warning: failed to load Midway3 scan: {e}', file=sys.stderr)

if not m2 and not m3:
    print('Error: no scan data from either cluster.', file=sys.stderr)
    sys.exit(1)

# Pick SU data from whichever has more complete info (prefer midway3)
su_source = m3 or m2
su = su_source.get('service_units', {}) if su_source else {}

# Sum jobs across clusters
def job_counts(scan):
    if not scan:
        return 0, 0, 0
    j = scan.get('jobs', {})
    return j.get('running', 0), j.get('pending', 0), j.get('total', 0)

m2r, m2p, m2t = job_counts(m2)
m3r, m3p, m3t = job_counts(m3)

report = {
    'report_meta': {
        'published_at': datetime.now().astimezone().isoformat(),
        'published_by': os.environ.get('USER', 'unknown'),
        'report_id': '${REPORT_ID}',
        'schema_version': '1.0.0'
    },
    'clusters': {
        'midway2': m2,
        'midway3': m3
    },
    'combined': {
        'service_units': {
            'allocated': su.get('allocated'),
            'consumed': su.get('consumed'),
            'remaining': su.get('remaining'),
            'period_end': su.get('period_end'),
            'days_left': su.get('days_left'),
            'burn_rate_per_day': (su.get('burn_rate') or {}).get('sus_per_day_avg')
        },
        'jobs_total': {
            'running': m2r + m3r,
            'pending': m2p + m3p,
            'total': m2t + m3t
        }
    }
}

print(json.dumps(report, indent=2))
" > "/tmp/cil_report_${REPORT_ID}.json"

if [[ $? -ne 0 ]]; then
    echo "Error: merge failed."
    exit 1
fi

# =============================================================================
# Step 4: Publish to public_html
# =============================================================================
echo "Publishing to $PUBLISH_DIR..."

# Set up directory and permissions
mkdir -p "$PUBLISH_DIR"
chmod o+x "$HOME"
chmod o+x "$HOME/public_html"
chmod o+x "$HOME/public_html/cil_scans"
chmod o+x "$PUBLISH_DIR"
chmod o+r "$PUBLISH_DIR"

# Copy report
cp "/tmp/cil_report_${REPORT_ID}.json" "$PUBLISH_DIR/$REPORT_FILE"

# Make all files readable
chmod -R o+r "$PUBLISH_DIR"

# Update latest.json symlink
ln -sf "$REPORT_FILE" "$PUBLISH_DIR/latest.json"

# Generate index.json
python3 -c "
import json, os, glob
from datetime import datetime

pub_dir = '${PUBLISH_DIR}'
reports = []
for f in sorted(glob.glob(os.path.join(pub_dir, 'report_*.json')), reverse=True):
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
# Step 5: Prune old reports
# =============================================================================
REPORT_COUNT=$(ls -1 "$PUBLISH_DIR"/report_*.json 2>/dev/null | wc -l)
if [[ "$REPORT_COUNT" -gt "$KEEP" ]]; then
    TO_DELETE=$((REPORT_COUNT - KEEP))
    echo "Pruning $TO_DELETE old reports (keeping $KEEP)..."
    ls -1t "$PUBLISH_DIR"/report_*.json | tail -n "$TO_DELETE" | xargs rm -f
fi

# Clean tmp
rm -f "/tmp/cil_report_${REPORT_ID}.json"

# Optionally clean source scans
if [[ "$CLEAN" = true ]]; then
    echo "Cleaning source scans..."
    [[ -n "$M2_SCAN_PATH" ]] && rm -f "$M2_SCAN_PATH"
    [[ -n "$M3_SCAN_PATH" ]] && rm -f "$M3_SCAN_PATH"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "Published: $PUBLISH_DIR/$REPORT_FILE"
echo "Latest:    $PUBLISH_DIR/latest.json"
echo "URL:       $PUBLIC_URL/latest.json"
echo "Reports:   $(ls -1 "$PUBLISH_DIR"/report_*.json 2>/dev/null | wc -l) / $KEEP"
echo ""