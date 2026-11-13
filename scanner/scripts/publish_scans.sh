#!/bin/bash
# Publishes scan results from /scratch/midway3 to public_html on Midway2
# Must be run from Midway2: ssh midway2.rcc.uchicago.edu
#
# Usage:
#   bash publish_scans.sh           # copy only
#   bash publish_scans.sh --clean   # copy, then remove the published files from scratch
#
# Order matters for readers polling the listing (the dashboard's
# update-snapshot.sh): new files are copied FIRST, files of older scans are
# pruned after, and latest_published.txt is written LAST. The listing is
# never empty or half-deleted mid-publish. cds3_* files (published
# separately by publish_append.sh) and subdirectories (quotas/,
# projections/) are left alone. Dot-files and dot-directories on scratch
# (flags, .partial/ set-asides) are never published or cleaned.

set -e

# Configuration
SOURCE_DIR="${SOURCE_DIR:-/scratch/midway3/${USER}/cil_scans}"
PUBLISH_DIR="${PUBLISH_DIR:-${HOME}/public_html/cil_scans}"
PUBLIC_URL="https://users.rcc.uchicago.edu/~${USER}/cil_scans"
CLEAN=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --clean) CLEAN=true ;;
        *) echo "Unknown argument: $arg"; exit 1 ;;
    esac
done

# Check we are on Midway2
if [[ "$(hostname)" != *"midway2"* ]]; then
    echo "Error: This script must be run from Midway2"
    echo "Connect first with: ssh midway2.rcc.uchicago.edu"
    exit 1
fi

# Check source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Error: Source directory not found: $SOURCE_DIR"
    exit 1
fi

# Top-level scan files to publish (no dot-files, no directories).
mapfile -t FILES < <(find "$SOURCE_DIR" -maxdepth 1 -type f ! -name '.*' -printf '%f\n' | sort)
if [ ${#FILES[@]} -eq 0 ]; then
    echo "Error: no scan files in $SOURCE_DIR"
    exit 1
fi
DATES=$(printf '%s\n' "${FILES[@]}" | grep -oE '_[0-9]{4}-[0-9]{2}-[0-9]{2}_' | tr -d _ | sort -u | tr '\n' ' ')
echo "Publishing ${#FILES[@]} file(s) for date(s): ${DATES}"

# Set up publish directory with correct permissions
mkdir -p "$PUBLISH_DIR"
chmod o+x "$HOME" "$HOME/public_html" "$PUBLISH_DIR"
chmod o+r "$PUBLISH_DIR"

# 1. Copy new files first (temp name + rename per file: readers never see a
#    truncated parquet file).
echo "Copying from: $SOURCE_DIR"
echo "         to:  $PUBLISH_DIR"
(cd "$SOURCE_DIR" && rsync -ah --progress -- "${FILES[@]}" "$PUBLISH_DIR/")
chmod o+r "$PUBLISH_DIR"/*

# 2. Prune top-level files of older scans (not cds3_*, not subdirectories).
declare -A KEEP=()
for f in "${FILES[@]}"; do KEEP["$f"]=1; done
PRUNED=0
while IFS= read -r f; do
    [ -n "${KEEP[$f]:-}" ] && continue
    case "$f" in cds3_*|latest_published.txt) continue ;; esac
    rm -f -- "$PUBLISH_DIR/$f"
    PRUNED=$((PRUNED + 1))
done < <(find "$PUBLISH_DIR" -maxdepth 1 -type f -printf '%f\n')
echo "Pruned ${PRUNED} file(s) of earlier scans"

# 3. Marker last: readers can tell a finished publish from one in progress.
{
    echo "dates=${DATES% }"
    echo "files=${#FILES[@]}"
    echo "published_at=$(date -Is)"
} > "$PUBLISH_DIR/latest_published.txt.tmp"
mv "$PUBLISH_DIR/latest_published.txt.tmp" "$PUBLISH_DIR/latest_published.txt"
chmod o+r "$PUBLISH_DIR/latest_published.txt"

echo ""
echo "Done. Files available at:"
echo "  $PUBLIC_URL"

# Optionally clean scratch: only what was just published, plus the flag.
if [ "$CLEAN" = true ]; then
    echo ""
    echo "Removing the ${#FILES[@]} published file(s) and the publish flag from $SOURCE_DIR"
    (cd "$SOURCE_DIR" && rm -f -- "${FILES[@]}" .scan_complete)
    echo "Done (dot-directories such as .partial/ are kept)."
fi
