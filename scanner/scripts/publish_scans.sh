#!/bin/bash
# Publishes scan results from /scratch/midway3 to public_html on Midway2
# Must be run from Midway2: ssh midway2.rcc.uchicago.edu
#
# Usage:
#   bash publish_scans.sh           # copy only
#   bash publish_scans.sh --clean   # copy and delete from scratch

set -e

# Configuration
SOURCE_DIR="${SOURCE_DIR:-/scratch/midway3/${USER}/cil_scans}"
PUBLISH_DIR="${PUBLISH_DIR:-${HOME}/public_html/cil_scans}"
PUBLIC_URL="http://users.rcc.uchicago.edu/~${USER}/cil_scans"
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

# Clear previously published files
echo "Clearing previous scan from $PUBLISH_DIR..."
rm -rf "$PUBLISH_DIR"

# Set up publish directory with correct permissions
mkdir -p "$PUBLISH_DIR"
chmod o+x "$HOME"
chmod o+x "$HOME/public_html"
chmod o+x "$PUBLISH_DIR"
chmod o+r "$PUBLISH_DIR"

# Copy files
echo "Copying from: $SOURCE_DIR"
echo "         to:  $PUBLISH_DIR"
rsync -ah --progress "$SOURCE_DIR/" "$PUBLISH_DIR/"

# Make files readable by web server
chmod -R o+r "$PUBLISH_DIR"

echo ""
echo "Done. Files available at:"
echo "  $PUBLIC_URL"

# Optionally clean scratch
if [ "$CLEAN" = true ]; then
    echo ""
    echo "Cleaning scratch: $SOURCE_DIR"
    rm -rf "$SOURCE_DIR"
    echo "Done."
fi