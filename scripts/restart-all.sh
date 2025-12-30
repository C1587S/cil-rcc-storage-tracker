#!/bin/bash
#
# Quick restart script for the dev-tracker-app
#
# Usage: ./scripts/restart-all.sh
#

set -e

echo "🔄 Restarting dev-tracker-app..."
echo ""

# Stop all containers
echo "1️⃣  Stopping containers..."
docker compose down

echo ""
echo "2️⃣  Starting containers..."
docker compose up -d

echo ""
echo "3️⃣  Waiting for services to be ready..."
sleep 10

echo ""
echo "4️⃣  Checking health..."
if curl -s http://localhost:8000/health | grep -q "healthy"; then
    echo "✅ API is healthy"
else
    echo "⚠️  API health check failed"
fi

echo ""
echo "5️⃣  Testing endpoints..."
echo "   - Snapshots: $(curl -s http://localhost:8000/api/snapshots | jq -r '.[0].snapshot_date' 2>/dev/null || echo 'FAILED')"
echo "   - Voronoi: $(curl -s --max-time 5 http://localhost:8000/api/voronoi/node/2025-12-27/root | jq -r '.node_id' 2>/dev/null || echo 'TIMEOUT')"

echo ""
echo "✨ Restart complete!"
echo ""
echo "🌐 Access the application:"
echo "   - Frontend: http://localhost:3000"
echo "   - API:      http://localhost:8000"
echo "   - Docs:     http://localhost:8000/docs"
echo ""
