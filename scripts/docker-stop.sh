#!/bin/bash
#
# Stop the storage tracker Docker stack
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "======================================"
echo "Storage Tracker - Stopping Services"
echo "======================================"
echo ""

if [ "$1" == "--remove-data" ]; then
    echo "WARNING: This will remove all data volumes!"
    echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
    sleep 5
    docker compose down -v
    echo "Services stopped and data removed."
else
    docker compose down
    echo "Services stopped. Data volumes preserved."
    echo ""
    echo "To remove data volumes as well, run:"
    echo "  $0 --remove-data"
fi

echo ""
