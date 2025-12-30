#!/usr/bin/env python3
"""Initialize ClickHouse database schema."""

import time
import sys
from clickhouse_driver import Client

def wait_for_clickhouse(host='clickhouse', max_retries=30):
    """Wait for ClickHouse to be ready."""
    print("Waiting for ClickHouse to be ready...")
    for i in range(max_retries):
        try:
            client = Client(host=host)
            client.execute("SELECT 1")
            print("ClickHouse is ready!")
            return client
        except Exception as e:
            print(f"Attempt {i+1}/{max_retries}: ClickHouse not ready yet...")
            time.sleep(2)

    print("ERROR: ClickHouse did not become ready in time")
    sys.exit(1)

def init_database(client):
    """Initialize database and tables."""
    print("Checking if database exists...")

    # Check if database exists
    result = client.execute("SELECT name FROM system.databases WHERE name = 'filesystem'")

    if result:
        print("Database 'filesystem' already exists. Skipping initialization.")
        return

    print("Database 'filesystem' does not exist. Creating...")

    # Create database
    client.execute("CREATE DATABASE filesystem")

    # Create main table
    client.execute("""
        CREATE TABLE filesystem.filesystem_snapshot (
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
    """)
    print("Created table: filesystem_snapshot")

    # Create materialized view
    client.execute("""
        CREATE MATERIALIZED VIEW filesystem.directory_recursive_sizes
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
        FROM filesystem.filesystem_snapshot
        WHERE is_directory = 1
    """)
    print("Created materialized view: directory_recursive_sizes")

    # Create voronoi table
    client.execute("""
        CREATE TABLE filesystem.voronoi_precomputed (
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
    """)
    print("Created table: voronoi_precomputed")

    print("Database initialization complete!")

if __name__ == "__main__":
    client = wait_for_clickhouse()
    init_database(client)
