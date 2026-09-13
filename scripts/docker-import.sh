#!/bin/bash
# Docker-based import script - no conda required!
#
# Usage:
#   ./scripts/docker-import.sh               # Import all snapshots from cil_scans/
#   ./scripts/docker-import.sh single <parquet> <date>  # Import single file
#   ./scripts/docker-import.sh voronoi <date>           # Compute voronoi only

set -e

SCANS_DIR="./cil_scans"

# Load ClickHouse password from .env
if [ -f ".env" ]; then
  CH_PASS=$(grep '^CLICKHOUSE_PASSWORD=' ".env" | cut -d= -f2-)
fi
CH_PASS="${CH_PASS:-}"
CH_CLIENT="clickhouse-client --password ${CH_PASS}"

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
            echo "Deduplicating entries (protects against overlapping scan runs)..."
            PARTITION_ID=$(echo "$SNAPSHOT_DATE" | tr -d - | cut -c1-6)
            docker compose exec -T clickhouse ${CH_CLIENT} --query "OPTIMIZE TABLE filesystem.entries PARTITION ID '$PARTITION_ID' FINAL DEDUPLICATE BY snapshot_date, parent_path, path"

            echo ""
            echo "Computing recursive directory sizes for $SNAPSHOT_DATE..."
            docker compose run --rm importer python scripts/compute_recursive_sizes_v2.py "$SNAPSHOT_DATE"

            # Permanent per-prefix history for housekeeping (root + 2 levels).
            # Snapshots are disposable; this table is NOT — never add a TTL
            # and never include it in snapshot deletion loops.
            echo "Writing daily_rollup for $SNAPSHOT_DATE..."
            docker compose exec -T clickhouse ${CH_CLIENT} --query "
                CREATE TABLE IF NOT EXISTS filesystem.daily_rollup (
                    date Date,
                    root String,
                    prefix String,
                    depth_rel UInt8,
                    bytes UInt64,
                    files UInt64,
                    dirs UInt64,
                    computed_at DateTime DEFAULT now()
                ) ENGINE = ReplacingMergeTree(computed_at)
                ORDER BY (date, root, prefix)"
            for ROLLUP_ROOT in /project/cil /cds3/cil; do
                ROOT_SLASHES=$(echo -n "$ROLLUP_ROOT" | tr -cd '/' | wc -c)
                docker compose exec -T clickhouse ${CH_CLIENT} --query "
                    INSERT INTO filesystem.daily_rollup (date, root, prefix, depth_rel, bytes, files, dirs)
                    SELECT snapshot_date, '$ROLLUP_ROOT', path,
                           toUInt8((length(path) - length(replaceAll(path, '/', ''))) - $ROOT_SLASHES),
                           recursive_size_bytes, recursive_file_count, recursive_dir_count
                    FROM filesystem.directory_recursive_sizes
                    WHERE snapshot_date = '$SNAPSHOT_DATE'
                      AND (path = '$ROLLUP_ROOT' OR path LIKE '$ROLLUP_ROOT/%')
                      AND (length(path) - length(replaceAll(path, '/', ''))) <= $ROOT_SLASHES + 2"
            done

            echo ""
            echo "Computing voronoi visualization for $SNAPSHOT_DATE..."
            # NOTE: must run AFTER recursive sizes — the voronoi precompute joins
            # directory_recursive_sizes for per-node file counts.
            docker compose run --rm importer python scripts/compute_voronoi_unified.py "$SNAPSHOT_DATE"

            # Separate tree per extra root (deletes are root-scoped, so the
            # trees coexist). Only when that root has entries in the snapshot.
            CDS3_COUNT=$(docker compose exec -T clickhouse ${CH_CLIENT} --query \
                "SELECT count() FROM filesystem.entries WHERE snapshot_date='$SNAPSHOT_DATE' AND startsWith(path, '/cds3/')" 2>/dev/null | tr -d '[:space:]')
            if [ "${CDS3_COUNT:-0}" -gt 0 ]; then
                echo ""
                echo "Computing voronoi for /cds3/cil ($CDS3_COUNT entries)..."
                docker compose run --rm importer python scripts/compute_voronoi_unified.py "$SNAPSHOT_DATE" --root /cds3/cil
            fi

            echo ""
            echo "Optimizing materialized views (deduplication)..."
            docker compose exec clickhouse ${CH_CLIENT} --query "OPTIMIZE TABLE filesystem.directory_hierarchy FINAL"

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
