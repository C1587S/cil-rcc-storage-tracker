#!/bin/bash
# Ingest the latest computing report into ClickHouse for historical tracking.
# Calls POST /api/computing/ingest which stores daily SU + quota snapshots.
#
# Usage:
#   ./scripts/ingest-computing.sh
#
# Designed to run once per day via cron.

API_URL="${API_URL:-http://localhost:8000}"

echo "[$(date)] Ingesting computing report..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/computing/ingest")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "[$(date)] OK: $BODY"
else
    echo "[$(date)] ERROR (HTTP $HTTP_CODE): $BODY"
    exit 1
fi
