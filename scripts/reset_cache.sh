#!/bin/bash

# Reset Cache Script
# This script clears all caches and restarts the application

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================="
echo "Cache Reset Script"
echo "=========================================="
echo ""

# Clear DuckDB database
echo "[1/5] Clearing DuckDB database..."
rm -f backend/data/storage_analytics.duckdb*
echo "  ✓ DuckDB database cleared"
echo ""

# Clear Next.js cache
echo "[2/5] Clearing Next.js cache..."
cd frontend
rm -rf .next
rm -rf node_modules/.cache 2>/dev/null || true
echo "  ✓ Next.js cache cleared"
echo ""

# Clear npm cache (optional)
echo "[3/5] Clearing npm cache..."
npm cache clean --force 2>/dev/null || true
echo "  ✓ npm cache cleared"
echo ""

cd "$PROJECT_ROOT"

# Verify snapshot files
echo "[4/5] Verifying snapshot files..."
if [ -d "backend/data/snapshots" ]; then
    SNAPSHOT_COUNT=$(find backend/data/snapshots -name "*.parquet" | wc -l)
    echo "  ✓ Found $SNAPSHOT_COUNT snapshot file(s)"
    find backend/data/snapshots -name "*.parquet" -exec ls -lh {} \;
else
    echo "  ⚠ No snapshots directory found"
fi
echo ""

echo "[5/5] Cache reset complete!"
echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo ""
echo "1. Start backend:"
echo "   cd backend && uvicorn app.main:app --reload"
echo ""
echo "2. Start frontend (in another terminal):"
echo "   cd frontend && npm run dev"
echo ""
echo "3. Open browser in INCOGNITO mode:"
echo "   http://localhost:3000"
echo ""
