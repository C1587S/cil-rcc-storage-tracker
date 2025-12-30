#!/bin/bash
set -e

echo "Initializing ClickHouse database..."

# Wait for ClickHouse to be ready
until clickhouse-client --host clickhouse --query "SELECT 1" > /dev/null 2>&1; do
    echo "Waiting for ClickHouse to be ready..."
    sleep 2
done

echo "ClickHouse is ready. Checking if database exists..."

# Check if filesystem database exists
DB_EXISTS=$(clickhouse-client --host clickhouse --query "EXISTS DATABASE filesystem" 2>/dev/null || echo "0")

if [ "$DB_EXISTS" = "0" ]; then
    echo "Database 'filesystem' does not exist. Creating..."

    # Create database
    clickhouse-client --host clickhouse --query "CREATE DATABASE filesystem"

    # Create main table
    clickhouse-client --host clickhouse --database filesystem --query "
    CREATE TABLE filesystem_snapshot (
        snapshot_date Date,
        path String,
        name String,
        size UInt64,
        is_directory UInt8,
        modified_time DateTime,
        accessed_time DateTime,
        created_time DateTime,
        permissions String,
        owner String,
        group_name String,
        inode UInt64,
        hard_links UInt32,
        device_id UInt64
    ) ENGINE = MergeTree()
    PARTITION BY toYYYYMM(snapshot_date)
    ORDER BY (snapshot_date, path)
    "

    # Create materialized view
    clickhouse-client --host clickhouse --database filesystem --query "
    CREATE MATERIALIZED VIEW directory_recursive_sizes
    ENGINE = MergeTree()
    ORDER BY (snapshot_date, path)
    POPULATE AS
    SELECT
        snapshot_date,
        path,
        name,
        size,
        is_directory,
        modified_time
    FROM filesystem_snapshot
    WHERE is_directory = 1
    "

    # Create voronoi table
    clickhouse-client --host clickhouse --database filesystem --query "
    CREATE TABLE voronoi_precomputed (
        snapshot_date Date,
        node_id String,
        name String,
        path String,
        size UInt64,
        is_directory UInt8,
        depth UInt32,
        children_ids Array(String),
        file_count Nullable(UInt64),
        is_synthetic UInt8,
        original_files Array(String)
    ) ENGINE = MergeTree()
    PARTITION BY toYYYYMM(snapshot_date)
    ORDER BY (snapshot_date, node_id)
    "

    echo "Database and tables created successfully!"
else
    echo "Database 'filesystem' already exists. Skipping initialization."
fi
