#!/bin/bash
#
# Setup Integration Scripts
#
# This script ensures all dependencies are available for the integration tools.
# It will use the backend's virtual environment or create a new one if needed.
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Setting up integration scripts...${NC}\n"

# Find project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

# Check if backend venv exists
if [ -d "$BACKEND_DIR/venv" ]; then
    echo -e "${GREEN}✓${NC} Found backend virtual environment"
    echo -e "${YELLOW}ℹ${NC} The integration scripts will use the backend's Python environment."
    echo ""
    echo "To use the integration scripts, activate the backend environment first:"
    echo ""
    echo -e "${BLUE}  cd backend${NC}"
    echo -e "${BLUE}  source venv/bin/activate${NC}"
    echo ""
    echo "Then run the scripts from anywhere:"
    echo ""
    echo -e "${BLUE}  cd ../scripts/integration${NC}"
    echo -e "${BLUE}  ./full_pipeline.sh --import /path/to/parquet 2025-12-11${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠${NC} Backend virtual environment not found"
    echo ""
    echo "Please set up the backend first:"
    echo ""
    echo -e "${BLUE}  cd backend${NC}"
    echo -e "${BLUE}  ./scripts/setup_dev.sh${NC}"
    echo ""
    echo "This will create a virtual environment with all required dependencies."
    echo ""
    exit 1
fi

# Verify dependencies
echo "Checking Python dependencies..."

# Activate venv temporarily
source "$BACKEND_DIR/venv/bin/activate"

if python -c "import pyarrow" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} pyarrow installed"
else
    echo -e "${YELLOW}⚠${NC} Installing pyarrow..."
    pip install pyarrow
fi

if python -c "import pandas" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} pandas installed"
else
    echo -e "${YELLOW}⚠${NC} Installing pandas..."
    pip install pandas
fi

echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "The integration scripts are ready to use."
echo ""
echo "Quick start:"
echo -e "${BLUE}  cd backend && source venv/bin/activate${NC}"
echo -e "${BLUE}  cd ../scripts/integration${NC}"
echo -e "${BLUE}  ./full_pipeline.sh --import /path/to/parquet 2025-12-11${NC}"
echo ""
