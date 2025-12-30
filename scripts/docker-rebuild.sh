#!/bin/bash
#
# Rebuild Docker images after code changes
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

SERVICE="${1:-}"

echo "======================================"
echo "Storage Tracker - Rebuild Services"
echo "======================================"
echo ""

if [ -z "$SERVICE" ]; then
    echo "Rebuilding all services..."
    docker compose build
    echo ""
    echo "Restarting all services..."
    docker compose up -d
else
    echo "Rebuilding $SERVICE..."
    docker compose build "$SERVICE"
    echo ""
    echo "Restarting $SERVICE..."
    docker compose up -d "$SERVICE"
fi

echo ""
echo "Rebuild complete!"
echo ""
echo "View logs with: docker compose logs -f ${SERVICE}"
echo ""
