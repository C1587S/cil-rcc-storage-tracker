#!/bin/bash
# Import all snapshots from cil_scans directory structure
#
# Prerequisites:
#   1. Docker Compose stack must be running: docker compose up -d
#   2. Conda environment must be active: conda activate cil-tracker
#
# Usage: ./scripts/import_all_snapshots.sh [base_dir]
#
# Directory structure expected:
#   base_dir/
#     source1/YYYY-MM-DD/*.parquet
#     source2/YYYY-MM-DD/*.parquet
#     ...

set -e

# Check if conda environment is active
if [ -z "$CONDA_DEFAULT_ENV" ] || [ "$CONDA_DEFAULT_ENV" != "cil-tracker" ]; then
    echo "Error: Conda environment 'cil-tracker' is not active"
    echo ""
    echo "Please activate the environment first:"
    echo "  conda activate cil-tracker"
    echo ""
    echo "If the environment doesn't exist, create it:"
    echo "  conda env create -f environment.yml"
    exit 1
fi

# Check if Docker is running
if ! docker compose ps | grep -q "tracker-clickhouse.*running"; then
    echo "Error: Docker Compose stack is not running"
    echo ""
    echo "Please start the stack first:"
    echo "  docker compose up -d"
    exit 1
fi

BASE_DIR="${1:-$HOME/Git/dev-tracker-app/cil_scans}"

if [ ! -d "$BASE_DIR" ]; then
    echo "Error: Directory $BASE_DIR does not exist"
    echo "Usage: $0 [base_dir]"
    exit 1
fi

cd "$(dirname "$0")/../clickhouse"

echo "Scanning for snapshots in: $BASE_DIR"
echo ""

# Find all unique dates across all sources
DATES=$(find "$BASE_DIR" -type d -name "20*-*-*" | sed 's|.*/||' | sort -u)

if [ -z "$DATES" ]; then
    echo "No snapshot dates found in $BASE_DIR"
    exit 1
fi

echo "Found snapshot dates:"
for date in $DATES; do
    echo "  - $date"
done
echo ""

# Process each date
for SNAPSHOT_DATE in $DATES; do
    echo "=========================================="
    echo "Processing snapshot date: $SNAPSHOT_DATE"
    echo "=========================================="

    # Find all parquet files for this date
    PARQUET_FILES=$(find "$BASE_DIR" -path "*/$SNAPSHOT_DATE/*.parquet" | sort)

    if [ -z "$PARQUET_FILES" ]; then
        echo "No parquet files found for $SNAPSHOT_DATE, skipping..."
        continue
    fi

    echo "Found $(echo "$PARQUET_FILES" | wc -l) parquet files to import"
    echo ""

    # Import each parquet file
    for parquet in $PARQUET_FILES; do
        echo "Importing: $(basename "$parquet")"
        python scripts/import_snapshot.py "$parquet" "$SNAPSHOT_DATE"
    done

    echo ""
    echo "Computing voronoi visualization for $SNAPSHOT_DATE..."
    python scripts/compute_voronoi_unified.py "$SNAPSHOT_DATE"

    echo ""
    echo "✓ Completed $SNAPSHOT_DATE"
    echo ""
done

echo "=========================================="
echo "All snapshots imported successfully!"
echo "=========================================="
echo ""
echo "Visit http://localhost:3000 to view your data."
