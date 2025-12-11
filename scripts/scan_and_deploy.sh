#!/bin/bash
set -e

# Configuration
SCAN_PATH="${1:-/Users/sebastiancadavidsanchez/Documents/Github/3cc}"
SNAPSHOT_DATE=$(date +%Y-%m-%d)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJECT_ROOT"

echo "=========================================="
echo "Storage Analytics: Scan to Dashboard"
echo "=========================================="
echo ""
echo "Scan Path: $SCAN_PATH"
echo "Snapshot Date: $SNAPSHOT_DATE"
echo ""

# Step 0: Clean old data
echo "[0/7] Cleaning old database..."
rm -rf backend/data/storage_analytics.duckdb*
echo "  ✓ Database cleaned"

# Step 1: Scan
echo ""
echo "[1/7] Scanning directory..."
./scanner/target/release/storage-scanner scan \
    --path "$SCAN_PATH" \
    --output "scan_testing/snapshot_${SNAPSHOT_DATE}.parquet" \
    --threads 8 \
    --batch-size 100000 \
    --verbose

echo ""
echo "[2/7] Import snapshot..."
cd backend
python scripts/import_snapshot.py \
    ../scan_testing \
    "$SNAPSHOT_DATE"

echo ""
echo "[3/7] Optimize snapshot (create materialized tables)..."
python scripts/optimize_snapshot.py "$SNAPSHOT_DATE"

echo ""
echo "[4/7] Stop existing servers..."
cd "$PROJECT_ROOT"
pkill -f "uvicorn.*app.main:app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

echo ""
echo "[5/7] Clear frontend cache..."
cd frontend
rm -rf .next node_modules/.cache

echo ""
echo "[6/7] Start backend..."
cd "$PROJECT_ROOT/backend"
uvicorn app.main:app --reload > /tmp/backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend
echo "  → Waiting for backend to start..."
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "  ✓ Backend ready (PID: $BACKEND_PID)"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "  ✗ Backend failed to start"
        tail -20 /tmp/backend.log
        exit 1
    fi
    sleep 1
done

echo ""
echo "[7/7] Start frontend..."
cd "$PROJECT_ROOT/frontend"
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!

echo "  ✓ Frontend starting (PID: $FRONTEND_PID)"

echo ""
echo "=========================================="
echo "Services Started!"
echo "=========================================="
echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Wait 10-15 seconds for frontend to build, then:"
echo "  Open http://localhost:3000 in INCOGNITO MODE"
echo ""
echo "Logs:"
echo "  Backend:  tail -f /tmp/backend.log"
echo "  Frontend: tail -f /tmp/frontend.log"
echo ""
echo "To stop:"
echo "  pkill -f 'uvicorn.*app.main:app'"
echo "  pkill -f 'next dev'"
echo ""
