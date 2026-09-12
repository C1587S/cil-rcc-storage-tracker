#!/bin/bash
# =============================================================================
# publish_append.sh - Append specific scan sources to the published directory
#
# Unlike publish_scans.sh (which replaces the full scan set), this copies only
# the given source prefixes from scratch to public_html WITHOUT touching the
# already-published files. Use it for out-of-band scans (cds3 from a login
# node, a new source scanned alone, a re-run of one failed source).
#
# Run on Midway2:
#   bash scanner/scripts/publish_append.sh cds3
#   bash scanner/scripts/publish_append.sh coastal cds3
# =============================================================================
set -e

SOURCE_DIR="${SOURCE_DIR:-/scratch/midway3/${USER}/cil_scans}"
PUBLISH_DIR="${PUBLISH_DIR:-${HOME}/public_html/cil_scans}"

if [ $# -eq 0 ]; then
    echo "Usage: $0 <source-prefix> [more-prefixes...]"
    echo "Example: $0 cds3 coastal"
    exit 1
fi

if [[ "$(hostname)" != *"midway2"* ]]; then
    echo "Error: run this from Midway2 (public_html is only served there)."
    exit 1
fi

mkdir -p "$PUBLISH_DIR"
chmod o+x "$HOME" "$HOME/public_html" "$PUBLISH_DIR" 2>/dev/null || true

TOTAL=0
for prefix in "$@"; do
    FILES=$(ls "$SOURCE_DIR"/${prefix}_* 2>/dev/null || true)
    if [ -z "$FILES" ]; then
        echo "[skip] No files matching ${prefix}_* in $SOURCE_DIR"
        continue
    fi
    COUNT=$(echo "$FILES" | wc -l)
    echo "[copy] ${prefix}: ${COUNT} file(s)"
    rsync -ah "$SOURCE_DIR"/${prefix}_* "$PUBLISH_DIR/"
    TOTAL=$((TOTAL + COUNT))
done

chmod -R o+r "$PUBLISH_DIR"

echo ""
echo "Appended ${TOTAL} file(s) to $PUBLISH_DIR"
echo "Published files for the requested sources:"
for prefix in "$@"; do
    ls "$PUBLISH_DIR"/${prefix}_* 2>/dev/null | tail -3
done
