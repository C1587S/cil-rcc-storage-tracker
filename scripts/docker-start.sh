#!/bin/bash
#
# Start the full storage tracker stack using Docker Compose
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "======================================"
echo "Storage Tracker - Docker Stack Startup"
echo "======================================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker compose is available
if ! docker compose version > /dev/null 2>&1; then
    echo "Error: Docker Compose is not available. Please install Docker Compose v2+."
    exit 1
fi

echo "Starting services..."
docker compose up -d

echo ""
echo "Waiting for services to be healthy..."
echo "(This may take 30-60 seconds for ClickHouse to initialize)"
echo ""

# Wait for ClickHouse to be healthy
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose exec -T clickhouse clickhouse-client --query "SELECT 1" > /dev/null 2>&1; then
        echo "✓ ClickHouse is healthy"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo ""
    echo "Warning: ClickHouse did not become healthy within ${TIMEOUT} seconds."
    echo "You may need to check the logs: docker compose logs clickhouse"
fi

echo ""
echo "Services started successfully!"
echo ""
echo "======================================"
echo "Access Points:"
echo "======================================"
echo "Web Interface:    http://localhost:3000"
echo "API Documentation: http://localhost:8000/docs"
echo "ClickHouse HTTP:   http://localhost:8123"
echo ""
echo "======================================"
echo "Next Steps:"
echo "======================================"
echo "1. Import snapshot data:"
echo "   cd clickhouse"
echo "   python scripts/import_snapshot.py <parquet-file> <date>"
echo ""
echo "2. Compute voronoi artifacts:"
echo "   python scripts/compute_voronoi_unified.py <date>"
echo ""
echo "3. Access the web interface at http://localhost:3000"
echo ""
echo "======================================"
echo "Useful Commands:"
echo "======================================"
echo "View logs:        docker compose logs -f"
echo "Stop services:    docker compose down"
echo "Restart service:  docker compose restart <service>"
echo ""
