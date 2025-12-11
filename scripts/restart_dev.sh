#!/bin/bash

# Development Server Restart Script
# Properly stops and restarts both backend and frontend

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================="
echo "Restarting Development Servers"
echo "=========================================="
echo ""

# Kill existing processes
echo "[1/5] Stopping existing servers..."

# Kill frontend
pkill -f "next dev" 2>/dev/null || true
echo "  ✓ Frontend stopped"

# Kill backend
pkill -f "uvicorn.*app.main:app" 2>/dev/null || true
echo "  ✓ Backend stopped"

sleep 2
echo ""

# Clear Next.js cache
echo "[2/5] Clearing Next.js cache..."
cd frontend
rm -rf .next
rm -rf node_modules/.cache 2>/dev/null || true
echo "  ✓ Cache cleared"
echo ""

cd "$PROJECT_ROOT"

# Verify snapshot files
echo "[3/5] Verifying data..."
if [ -f "backend/data/snapshots/2025-12-11/snapshot_2025-12-11.parquet" ]; then
    SIZE=$(du -h "backend/data/snapshots/2025-12-11/snapshot_2025-12-11.parquet" | cut -f1)
    echo "  ✓ Snapshot found: $SIZE"
else
    echo "  ⚠ Warning: Snapshot file not found"
fi
echo ""

# Start backend
echo "[4/5] Starting backend..."
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "  ✓ Backend started (PID: $BACKEND_PID)"
echo "  → Logs: tail -f /tmp/backend.log"
echo ""

# Wait for backend to be ready
echo "  → Waiting for backend to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "  ✓ Backend is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "  ✗ Backend failed to start"
        exit 1
    fi
    sleep 1
done
echo ""

# Start frontend
echo "[5/5] Starting frontend..."
cd "$PROJECT_ROOT/frontend"
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "  ✓ Frontend started (PID: $FRONTEND_PID)"
echo "  → Logs: tail -f /tmp/frontend.log"
echo ""

echo "=========================================="
echo "Servers Started Successfully!"
echo "=========================================="
echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "API Test: curl http://localhost:8000/api/snapshots/"
echo ""
echo "To stop servers:"
echo "  pkill -f 'next dev'"
echo "  pkill -f 'uvicorn.*app.main:app'"
echo ""
echo "To view logs:"
echo "  Backend:  tail -f /tmp/backend.log"
echo "  Frontend: tail -f /tmp/frontend.log"
echo ""
