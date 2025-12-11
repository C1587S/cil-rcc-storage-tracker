#!/bin/bash
#
# Restart Backend with Logging
#
# This script restarts the backend with proper logging to help debug issues.
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Restarting backend with enhanced logging...${NC}\n"

# Find project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

cd "$BACKEND_DIR"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "ERROR: Virtual environment not found. Run setup_dev.sh first."
    exit 1
fi

# Kill existing backend process
echo "Stopping existing backend..."
pkill -f "uvicorn app.main:app" || true
sleep 2

# Activate venv and start backend
echo -e "${GREEN}Starting backend with enhanced logging...${NC}"
echo "Backend will be available at: http://localhost:8000"
echo "API docs at: http://localhost:8000/docs"
echo ""
echo "Watch the logs below for any errors:"
echo "=================================================="
echo ""

source venv/bin/activate
export PYTHONUNBUFFERED=1
export LOG_LEVEL=INFO

# Start backend in foreground with verbose logging
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --log-level info
