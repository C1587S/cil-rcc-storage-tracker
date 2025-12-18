#!/bin/bash
# Check import progress

echo "ClickHouse Import Progress"
echo "=========================="
echo ""

echo "Current row count:"
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT count() as total_rows FROM filesystem.entries" 2>/dev/null || echo "  (checking...)"

echo ""
echo "Rows by snapshot:"
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT snapshot_date, count() as rows FROM filesystem.entries GROUP BY snapshot_date ORDER BY snapshot_date" 2>/dev/null || echo "  (checking...)"

echo ""
echo "Table sizes:"
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT
     table,
     formatReadableSize(sum(bytes)) AS size,
     formatReadableQuantity(sum(rows)) AS rows
   FROM system.parts
   WHERE database = 'filesystem' AND active = 1
   GROUP BY table
   ORDER BY sum(bytes) DESC" 2>/dev/null || echo "  (checking...)"

echo ""
echo "Recent activity:"
docker exec tracker-clickhouse clickhouse-client --query \
  "SELECT
     query_duration_ms,
     read_rows,
     formatReadableSize(read_bytes) as data_read
   FROM system.query_log
   WHERE type = 'QueryFinish'
     AND query LIKE '%INSERT%'
     AND event_time >= now() - INTERVAL 5 MINUTE
   ORDER BY event_time DESC
   LIMIT 5" 2>/dev/null || echo "  (checking...)"
