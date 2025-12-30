#!/bin/bash
#
# View logs from Docker services
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

SERVICE="${1:-}"

if [ -z "$SERVICE" ]; then
    echo "Viewing logs from all services..."
    echo "Press Ctrl+C to stop"
    echo ""
    docker compose logs -f
else
    echo "Viewing logs from $SERVICE..."
    echo "Press Ctrl+C to stop"
    echo ""
    docker compose logs -f "$SERVICE"
fi
