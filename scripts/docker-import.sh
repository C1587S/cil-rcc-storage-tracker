#!/bin/bash
# Docker-based import script - no conda required!
#
# Usage:
#   ./scripts/docker-import.sh               # Import all snapshots from cil_scans/
#   ./scripts/docker-import.sh single <parquet> <date>  # Import single file
#   ./scripts/docker-import.sh voronoi <date>           # Compute voronoi only

set -e

SCANS_DIR="./cil_scans"

# Check if Docker is running
if ! docker compose ps clickhouse 2>/dev/null | grep -q "Up\|running"; then
    echo "Error: Docker Compose stack is not running"
    echo ""
    echo "Please start the stack first:"
    echo "  docker compose up -d"
    exit 1
fi

# Build the importer image if needed
echo "Building importer image..."
docker compose build importer

case "${1:-all}" in
    single)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Usage: $0 single <parquet_file> <date>"
            echo "Example: $0 single /cil_scans/battuta/2025-12-27/snapshot.parquet 2025-12-27"
            exit 1
        fi
        PARQUET_FILE="$2"
        DATE="$3"

        echo "Importing single snapshot: $PARQUET_FILE ($DATE)"
        docker compose run --rm importer python scripts/import_snapshot.py "$PARQUET_FILE" "$DATE"

        echo ""
        echo "Computing voronoi visualization..."
        docker compose run --rm importer python scripts/compute_voronoi_unified.py "$DATE"
        ;;

    voronoi)
        if [ -z "$2" ]; then
            echo "Usage: $0 voronoi <date>"
            echo "Example: $0 voronoi 2025-12-27"
            exit 1
        fi
        DATE="$2"

        echo "Computing voronoi visualization for $DATE..."
        docker compose run --rm importer python scripts/compute_voronoi_unified.py "$DATE"
        ;;

    all)
        echo "Scanning for snapshots in: $SCANS_DIR"
        echo ""

        # Find all unique dates
        DATES=$(find "$SCANS_DIR" -type d -name "20*-*-*" 2>/dev/null | sed 's|.*/||' | sort -u)

        if [ -z "$DATES" ]; then
            echo "No snapshot dates found in $SCANS_DIR"
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
            PARQUET_FILES=$(find "$SCANS_DIR" -path "*/$SNAPSHOT_DATE/*.parquet" 2>/dev/null | sort)

            if [ -z "$PARQUET_FILES" ]; then
                echo "No parquet files found for $SNAPSHOT_DATE, skipping..."
                continue
            fi

            echo "Found $(echo "$PARQUET_FILES" | wc -l) parquet files to import"
            echo ""

            # Get the directory containing parquet files for this date
            # All parquet files should be in subdirectories like battuta_shares/2025-12-27/
            # We need to pass each source directory separately
            SOURCE_DIRS=$(find "$SCANS_DIR" -path "*/$SNAPSHOT_DATE" -type d | sort)

            # Import each source directory
            FIRST_IMPORT=true
            for source_dir in $SOURCE_DIRS; do
                # Convert to container path
                CONTAINER_PATH="/scans/${source_dir#$SCANS_DIR/}"
                SOURCE_NAME=$(basename "$(dirname "$source_dir")")
                echo "Importing: $SOURCE_NAME"

                # Only clear data on first import, append for subsequent imports
                if [ "$FIRST_IMPORT" = true ]; then
                    docker compose run --rm importer python scripts/import_snapshot.py "$CONTAINER_PATH"
                    FIRST_IMPORT=false
                else
                    docker compose run --rm importer python scripts/import_snapshot.py "$CONTAINER_PATH" --no-clear
                fi
            done

            echo ""
            echo "Computing voronoi visualization for $SNAPSHOT_DATE..."
            docker compose run --rm importer python scripts/compute_voronoi_unified.py "$SNAPSHOT_DATE"

            echo ""
            echo "Computing recursive directory sizes for $SNAPSHOT_DATE..."
            docker compose run --rm importer python scripts/compute_recursive_sizes_v2.py "$SNAPSHOT_DATE"

            echo ""
            echo "Optimizing materialized views (deduplication)..."
            docker compose exec clickhouse clickhouse-client --query "OPTIMIZE TABLE filesystem.directory_hierarchy FINAL"

            echo ""
            echo "✓ Completed $SNAPSHOT_DATE"
            echo ""
        done

        echo "=========================================="
        echo "All snapshots imported successfully!"
        echo "=========================================="
        echo ""
        echo "Visit http://localhost:3000 to view your data."
        ;;

    *)
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  all                          Import all snapshots from cil_scans/ (default)"
        echo "  single <parquet> <date>      Import a single parquet file"
        echo "  voronoi <date>               Compute voronoi visualization only"
        echo ""
        echo "Examples:"
        echo "  $0                          # Import everything"
        echo "  $0 single /scans/battuta/2025-12-27/snapshot.parquet 2025-12-27"
        echo "  $0 voronoi 2025-12-27"
        exit 1
        ;;
esac
