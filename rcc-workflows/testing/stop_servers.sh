#!/bin/bash

# Stop all running development servers

echo "Stopping development servers..."

# Stop uvicorn backend
BACKEND_PIDS=$(pgrep -f "uvicorn app.main:app")
if [ -n "$BACKEND_PIDS" ]; then
    echo "  Stopping backend (PIDs: $BACKEND_PIDS)"
    kill $BACKEND_PIDS
    echo "  ✓ Backend stopped"
else
    echo "  ✓ No backend running"
fi

# Stop Next.js frontend
FRONTEND_PIDS=$(pgrep -f "next dev")
if [ -n "$FRONTEND_PIDS" ]; then
    echo "  Stopping frontend (PIDs: $FRONTEND_PIDS)"
    kill $FRONTEND_PIDS
    echo "  ✓ Frontend stopped"
else
    echo "  ✓ No frontend running"
fi

echo ""
echo "All development servers stopped."
echo "Safe to run Docker Compose now."
