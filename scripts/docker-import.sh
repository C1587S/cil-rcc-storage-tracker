#!/bin/bash
# Docker-based import script - no conda required!
#
# Usage:
#   ./scripts/docker-import.sh date <YYYY-MM-DD>        # Import ONE snapshot date (what cron uses)
#   ./scripts/docker-import.sh all                      # Re-import EVERY date found in cil_scans/
#   ./scripts/docker-import.sh single <parquet> <date>  # Import single file
#   ./scripts/docker-import.sh voronoi <date>           # Compute voronoi only
#
# `date` touches only that snapshot: the dedup and the materialized-view
# optimize are scoped to its month partition, and no other date is
# re-imported. `all` rewrites every date on disk (and re-inserting a date
# adds to the summing materialized views again), so use it only to rebuild.
#
# DRY_RUN=1 prints the commands instead of running them.

set -e

SCANS_DIR="./cil_scans"

# clickhouse-client inside the container reads CLICKHOUSE_PASSWORD from the
# container environment; never put the password on a command line (ps).
CH_CLIENT="clickhouse-client"

ch()  { if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY ch: $1"; else docker compose exec -T clickhouse ${CH_CLIENT} --query "$1"; fi; }
run() { if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY run: $*"; else docker compose run --rm -T importer "$@"; fi; }

if [ "${DRY_RUN:-0}" != 1 ]; then
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
fi

IMPORT_FAILURES=""

# All per-date steps for one snapshot date. Records failed sources in
# IMPORT_FAILURES instead of aborting, so one bad source cannot block others.
import_date() {
    local SNAPSHOT_DATE="$1"
    echo "=========================================="
    echo "Processing snapshot date: $SNAPSHOT_DATE"
    echo "=========================================="

    local SOURCE_DIRS
    SOURCE_DIRS=$(find "$SCANS_DIR" -mindepth 2 -maxdepth 2 -type d -name "$SNAPSHOT_DATE" | sort)
    if [ -z "$SOURCE_DIRS" ]; then
        echo "No source directories for $SNAPSHOT_DATE under $SCANS_DIR"
        IMPORT_FAILURES="$IMPORT_FAILURES $SNAPSHOT_DATE/(none)"
        return
    fi

    # Only clear data on first import, append for subsequent imports
    local FIRST_IMPORT=true source_dir CONTAINER_PATH SOURCE_NAME
    for source_dir in $SOURCE_DIRS; do
        CONTAINER_PATH="/scans/${source_dir#$SCANS_DIR/}"
        SOURCE_NAME=$(basename "$(dirname "$source_dir")")
        if ! ls "$source_dir"/*.parquet >/dev/null 2>&1; then
            echo "  [skip] $SOURCE_NAME/$SNAPSHOT_DATE: directory has no parquet files"
            continue
        fi
        echo "Importing: $SOURCE_NAME"
        if [ "$FIRST_IMPORT" = true ]; then
            if run python scripts/import_snapshot.py "$CONTAINER_PATH"; then
                FIRST_IMPORT=false
            else
                IMPORT_FAILURES="$IMPORT_FAILURES $SNAPSHOT_DATE/$SOURCE_NAME"
            fi
        else
            run python scripts/import_snapshot.py "$CONTAINER_PATH" --no-clear \
                || IMPORT_FAILURES="$IMPORT_FAILURES $SNAPSHOT_DATE/$SOURCE_NAME"
        fi
    done

    local PARTITION_ID
    PARTITION_ID=$(echo "$SNAPSHOT_DATE" | tr -d - | cut -c1-6)
    echo ""
    echo "Deduplicating entries in partition $PARTITION_ID (expected to remove nothing)..."
    ch "OPTIMIZE TABLE filesystem.entries PARTITION ID '$PARTITION_ID' FINAL DEDUPLICATE BY snapshot_date, parent_path, path"

    echo ""
    echo "Computing recursive directory sizes for $SNAPSHOT_DATE..."
    run python scripts/compute_recursive_sizes_v2.py "$SNAPSHOT_DATE"

    # Permanent per-prefix history for housekeeping (root + 2 levels).
    # Snapshots are disposable; this table is NOT — never add a TTL
    # and never include it in snapshot deletion loops.
    echo "Writing daily_rollup for $SNAPSHOT_DATE..."
    ch "
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
    local ROLLUP_ROOT ROOT_SLASHES
    for ROLLUP_ROOT in /project/cil /cds3/cil; do
        ROOT_SLASHES=$(echo -n "$ROLLUP_ROOT" | tr -cd '/' | wc -c)
        ch "
            INSERT INTO filesystem.daily_rollup (date, root, prefix, depth_rel, bytes, files, dirs)
            SELECT snapshot_date, '$ROLLUP_ROOT', path,
                   toUInt8((length(path) - length(replaceAll(path, '/', ''))) - $ROOT_SLASHES),
                   recursive_size_bytes, recursive_file_count, recursive_dir_count
            FROM filesystem.directory_recursive_sizes
            WHERE snapshot_date = '$SNAPSHOT_DATE'
              AND (path = '$ROLLUP_ROOT' OR startsWith(path, '$ROLLUP_ROOT/'))
              AND (length(path) - length(replaceAll(path, '/', ''))) <= $ROOT_SLASHES + 2"
    done

    echo ""
    echo "Computing voronoi visualization for $SNAPSHOT_DATE..."
    # NOTE: must run AFTER recursive sizes — the voronoi precompute joins
    # directory_recursive_sizes for per-node file counts.
    run python scripts/compute_voronoi_unified.py "$SNAPSHOT_DATE"

    # Separate tree per extra root (deletes are root-scoped, so the
    # trees coexist). Only when that root has entries in the snapshot.
    local CDS3_COUNT
    CDS3_COUNT=$(ch "SELECT count() FROM filesystem.entries WHERE snapshot_date='$SNAPSHOT_DATE' AND startsWith(path, '/cds3/')" 2>/dev/null | tr -d '[:space:]')
    if [[ "${CDS3_COUNT:-0}" =~ ^[0-9]+$ ]] && [ "${CDS3_COUNT:-0}" -gt 0 ]; then
        echo ""
        echo "Computing voronoi for /cds3/cil ($CDS3_COUNT entries)..."
        run python scripts/compute_voronoi_unified.py "$SNAPSHOT_DATE" --root /cds3/cil
    fi

    echo ""
    echo "Optimizing directory_hierarchy partition $PARTITION_ID (deduplication)..."
    ch "OPTIMIZE TABLE filesystem.directory_hierarchy PARTITION ID '$PARTITION_ID' FINAL"

    echo ""
    echo "✓ Completed $SNAPSHOT_DATE"
    echo ""
}

finish() {
    if [ -n "$IMPORT_FAILURES" ]; then
        echo "=========================================="
        echo "FAILED source imports:$IMPORT_FAILURES"
        echo "Other sources were still processed; fix or remove the listed"
        echo "date directories under cil_scans/ and re-run."
        echo "=========================================="
        exit 1
    fi
    echo "=========================================="
    echo "Import finished successfully."
    echo "=========================================="
}

case "${1:-all}" in
    date)
        if ! [[ "${2:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
            echo "Usage: $0 date <YYYY-MM-DD>"
            exit 1
        fi
        import_date "$2"
        finish
        ;;

    single)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Usage: $0 single <parquet_file> <date>"
            echo "Example: $0 single /cil_scans/battuta/2025-12-27/snapshot.parquet 2025-12-27"
            exit 1
        fi
        PARQUET_FILE="$2"
        DATE="$3"

        echo "Importing single snapshot: $PARQUET_FILE ($DATE)"
        run python scripts/import_snapshot.py "$PARQUET_FILE" "$DATE"

        echo ""
        echo "Computing voronoi visualization..."
        run python scripts/compute_voronoi_unified.py "$DATE"
        ;;

    voronoi)
        if [ -z "$2" ]; then
            echo "Usage: $0 voronoi <date>"
            echo "Example: $0 voronoi 2025-12-27"
            exit 1
        fi
        DATE="$2"

        echo "Computing voronoi visualization for $DATE..."
        run python scripts/compute_voronoi_unified.py "$DATE"
        ;;

    all)
        echo "Scanning for snapshots in: $SCANS_DIR"
        echo "WARNING: re-imports every date on disk; use 'date <YYYY-MM-DD>' for normal updates."
        echo ""
        DATES=$(find "$SCANS_DIR" -mindepth 2 -maxdepth 2 -type d -name "20*-*-*" 2>/dev/null | sed 's|.*/||' | sort -u)
        if [ -z "$DATES" ]; then
            echo "No snapshot dates found in $SCANS_DIR"
            exit 1
        fi
        echo "Found snapshot dates:"
        for date in $DATES; do
            echo "  - $date"
        done
        echo ""
        for SNAPSHOT_DATE in $DATES; do
            import_date "$SNAPSHOT_DATE"
        done
        finish
        echo ""
        echo "Visit http://localhost:3000 to view your data."
        ;;

    *)
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  date <YYYY-MM-DD>            Import one snapshot date (normal updates)"
        echo "  all                          Re-import every date in cil_scans/ (rebuilds only)"
        echo "  single <parquet> <date>      Import a single parquet file"
        echo "  voronoi <date>               Compute voronoi visualization only"
        echo ""
        echo "Examples:"
        echo "  $0 date 2026-11-13"
        echo "  $0 voronoi 2026-11-13"
        exit 1
        ;;
esac
