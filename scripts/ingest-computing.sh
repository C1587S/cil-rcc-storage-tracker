#!/bin/bash
# Ingest the latest computing report into ClickHouse for historical tracking.
# Calls POST /api/computing/ingest which stores daily SU + quota snapshots.
#
# Usage:
#   ./scripts/ingest-computing.sh
#
# Designed to run once per day via cron. The endpoint is operator-only: the
# key is read from the project .env (HK_OPERATOR_KEY) and passed to curl on
# stdin so it never appears in the process list.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
API_URL="${API_URL:-http://localhost:8000}"

if [ -z "${HK_OPERATOR_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
    HK_OPERATOR_KEY=$(grep -E '^HK_OPERATOR_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
fi
if [ -z "${HK_OPERATOR_KEY:-}" ]; then
    echo "[$(date)] ERROR: HK_OPERATOR_KEY is not set (expected in $ENV_FILE)"
    exit 1
fi

echo "[$(date)] Ingesting computing report..."
RESPONSE=$(printf 'header = "X-Operator-Key: %s"\n' "$HK_OPERATOR_KEY" |
    curl -s -K - --max-time 120 -w "\n%{http_code}" -X POST "${API_URL}/api/computing/ingest")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "[$(date)] OK: $BODY"
else
    echo "[$(date)] ERROR (HTTP $HTTP_CODE): $BODY"
    exit 1
fi
