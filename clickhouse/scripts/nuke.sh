#!/bin/bash
# =====================================================
# Nuke Script - Complete Database Reset
# =====================================================
#
# This script completely removes all ClickHouse data:
# - Drops all tables and views
# - Deletes all data files
# - Resets the database to empty state
#
# WARNING: This is irreversible. All data will be lost.
# You can rebuild from Parquet files using import scripts.
# =====================================================

set -e  # Exit on error

echo "=========================================="
echo "ClickHouse Database Nuke Script"
echo "=========================================="
echo ""
echo "WARNING: This will DELETE ALL DATA in ClickHouse!"
echo "This includes:"
echo "  - All tables and materialized views"
echo "  - All imported snapshot data"
echo "  - All indexes and metadata"
echo ""
echo "You can rebuild from Parquet files later."
echo ""

# Ask for confirmation
read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted. No changes made."
    exit 0
fi

echo ""
echo "Proceeding with database nuke..."
echo ""

# Check if ClickHouse container is running
if ! docker ps | grep -q tracker-clickhouse; then
    echo "ClickHouse container is not running."
    echo "Starting container..."
    cd "$(dirname "$0")/.." && docker compose up -d
    echo "Waiting for ClickHouse to start..."
    sleep 5
fi

echo "Step 1: Dropping all materialized views..."
docker exec tracker-clickhouse clickhouse-client --query "
    DROP VIEW IF EXISTS filesystem.directory_hierarchy;
    DROP VIEW IF EXISTS filesystem.directory_sizes;
    DROP VIEW IF EXISTS filesystem.file_type_distribution;
    DROP VIEW IF EXISTS filesystem.owner_distribution;
    DROP VIEW IF EXISTS filesystem.top_level_summary;
    DROP VIEW IF EXISTS filesystem.heavy_files;
    DROP VIEW IF EXISTS filesystem.depth_distribution;
    DROP VIEW IF EXISTS filesystem.size_buckets;
    DROP VIEW IF EXISTS filesystem.age_distribution;
" 2>/dev/null || echo "  (some views may not exist)"

echo "Step 2: Dropping all tables..."
docker exec tracker-clickhouse clickhouse-client --query "
    DROP TABLE IF EXISTS filesystem.entries;
    DROP TABLE IF EXISTS filesystem.snapshots;
    DROP TABLE IF EXISTS filesystem.search_index;
" 2>/dev/null || echo "  (some tables may not exist)"

echo "Step 3: Dropping database..."
docker exec tracker-clickhouse clickhouse-client --query "
    DROP DATABASE IF EXISTS filesystem;
" 2>/dev/null || true

echo "Step 4: Stopping ClickHouse container..."
cd "$(dirname "$0")/.." && docker compose down

echo "Step 5: Removing data files..."
data_dir="$(dirname "$0")/../data/clickhouse"
if [ -d "$data_dir" ]; then
    # ClickHouse files are owned by uid 101, so we need sudo to remove them
    echo "  Removing: $data_dir (requires sudo)"
    sudo rm -rf "$data_dir"
    echo "  ✓ Removed"
else
    echo "  Data directory not found (already clean)"
fi

echo ""
echo "=========================================="
echo "Database Nuke Complete!"
echo "=========================================="
echo ""
echo "All ClickHouse data has been removed."
echo ""
echo "To rebuild:"
echo "  1. Start ClickHouse: docker compose up -d"
echo "  2. Initialize schema: python scripts/setup_database.py"
echo "  3. Import data: python scripts/import_snapshot.py /path/to/snapshot"
echo ""
