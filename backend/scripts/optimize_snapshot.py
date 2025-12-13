"""
Optimize snapshot by creating materialized summary tables.

This script pre-computes expensive aggregations so the frontend
can query fast materialized tables instead of scanning millions of rows.

Usage:
    python scripts/optimize_snapshot.py <snapshot_date>

Example:
    python scripts/optimize_snapshot.py 2025-12-11
"""

import sys
import time
import logging
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database.duckdb_client import DuckDBClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def optimize_snapshot(snapshot_date: str):
    """
    Create materialized summary tables for a snapshot.

    This is CRITICAL for performance with large snapshots (1M+ files).
    Pre-computes expensive queries including directory hierarchies,
    reducing query times from 55+ minutes to seconds.
    """

    logger.info(f"Optimizing snapshot: {snapshot_date}")
    logger.info("="  * 60)

    # Determine backend directory
    script_dir = Path(__file__).parent
    backend_dir = script_dir.parent

    # Initialize DuckDB client with explicit paths
    db_path = backend_dir / "data" / "storage_analytics.duckdb"
    snapshots_path = backend_dir / "data" / "snapshots"

    logger.info(f"Backend directory: {backend_dir}")
    logger.info(f"Database path: {db_path}")
    logger.info(f"Snapshots path: {snapshots_path}")

    db = DuckDBClient(db_path=str(db_path), snapshots_path=str(snapshots_path))
    start_total = time.time()

    # 1. Create snapshot summary table
    logger.info("[1/7] Creating snapshot_summary table...")
    start = time.time()

    db.conn.execute("""
        CREATE TABLE IF NOT EXISTS snapshot_summary (
            date VARCHAR PRIMARY KEY,
            file_count BIGINT,
            total_size BIGINT,
            top_level_dirs VARCHAR[],
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Delete existing entry for this snapshot
    db.conn.execute(f"""
        DELETE FROM snapshot_summary
        WHERE date = '{snapshot_date}'
    """)

    # Insert pre-computed summary
    db.conn.execute(f"""
        INSERT INTO snapshot_summary (date, file_count, total_size, top_level_dirs)
        SELECT
            CAST(snapshot_date AS VARCHAR) as date,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            LIST(DISTINCT top_level_dir) as top_level_dirs
        FROM file_snapshots
        WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot_date}'
        GROUP BY snapshot_date
    """)

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s")

    # 2. Create directory breakdown table
    logger.info("[2/7] Creating directory_breakdown table...")
    start = time.time()

    db.conn.execute("""
        CREATE TABLE IF NOT EXISTS directory_breakdown (
            snapshot_date VARCHAR,
            top_level_dir VARCHAR,
            file_count BIGINT,
            total_size BIGINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (snapshot_date, top_level_dir)
        )
    """)

    # Delete existing entries
    db.conn.execute(f"""
        DELETE FROM directory_breakdown
        WHERE snapshot_date = '{snapshot_date}'
    """)

    # Insert pre-computed breakdown
    db.conn.execute(f"""
        INSERT INTO directory_breakdown (snapshot_date, top_level_dir, file_count, total_size)
        SELECT
            CAST(snapshot_date AS VARCHAR) as snapshot_date,
            top_level_dir,
            COUNT(*) as file_count,
            SUM(size) as total_size
        FROM file_snapshots
        WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot_date}'
        GROUP BY snapshot_date, top_level_dir
    """)

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s")

    # 3. Create file type breakdown table
    logger.info("[3/7] Creating filetype_breakdown table...")
    start = time.time()

    db.conn.execute("""
        CREATE TABLE IF NOT EXISTS filetype_breakdown (
            snapshot_date VARCHAR,
            file_type VARCHAR,
            file_count BIGINT,
            total_size BIGINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (snapshot_date, file_type)
        )
    """)

    # Delete existing entries
    db.conn.execute(f"""
        DELETE FROM filetype_breakdown
        WHERE snapshot_date = '{snapshot_date}'
    """)

    # Insert pre-computed breakdown (top 50 types)
    db.conn.execute(f"""
        INSERT INTO filetype_breakdown (snapshot_date, file_type, file_count, total_size)
        SELECT
            CAST(snapshot_date AS VARCHAR) as snapshot_date,
            file_type,
            COUNT(*) as file_count,
            SUM(size) as total_size
        FROM file_snapshots
        WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot_date}'
        AND file_type != 'directory'
        GROUP BY snapshot_date, file_type
        ORDER BY total_size DESC
        LIMIT 50
    """)

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s")

    # 4. Create heavy files table
    logger.info("[4/7] Creating heavy_files table...")
    start = time.time()

    db.conn.execute("""
        CREATE TABLE IF NOT EXISTS heavy_files (
            snapshot_date VARCHAR,
            path VARCHAR,
            size BIGINT,
            modified_time BIGINT,
            file_type VARCHAR,
            parent_path VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (snapshot_date, path)
        )
    """)

    # Delete existing entries
    db.conn.execute(f"""
        DELETE FROM heavy_files
        WHERE snapshot_date = '{snapshot_date}'
    """)

    # Insert top 1000 heaviest files
    db.conn.execute(f"""
        INSERT INTO heavy_files (snapshot_date, path, size, modified_time, file_type, parent_path)
        SELECT
            CAST(snapshot_date AS VARCHAR) as snapshot_date,
            path,
            size,
            modified_time,
            file_type,
            parent_path
        FROM file_snapshots
        WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot_date}'
        AND file_type != 'directory'
        ORDER BY size DESC
        LIMIT 1000
    """)

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s")

    # 5. Create directory hierarchy table (CRITICAL for performance)
    logger.info("[5/7] Creating directory_hierarchy table...")
    logger.info("  This may take several minutes for large snapshots...")
    start = time.time()

    # Create the table schema
    db.conn.execute("""
        CREATE TABLE IF NOT EXISTS directory_hierarchy (
            snapshot_date VARCHAR,
            parent_path VARCHAR,
            child_name VARCHAR,
            child_path VARCHAR,
            is_directory BOOLEAN,
            total_size BIGINT,
            file_count BIGINT,
            last_modified BIGINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (snapshot_date, parent_path, child_name)
        )
    """)

    # Delete existing entries for this snapshot
    db.conn.execute(f"""
        DELETE FROM directory_hierarchy
        WHERE snapshot_date = '{snapshot_date}'
    """)

    # Build hierarchy by aggregating immediate children
    # This pre-computes what get_immediate_children() does on-the-fly
    logger.info("  Building parent-child relationships...")
    db.conn.execute(f"""
        INSERT INTO directory_hierarchy (
            snapshot_date, parent_path, child_name, child_path,
            is_directory, total_size, file_count, last_modified
        )
        WITH all_items AS (
            SELECT
                parent_path,
                path,
                size,
                modified_time,
                -- Extract child name (last part of path)
                split_part(path, '/', length(regexp_split_to_array(path, '/'))) as child_name
            FROM file_snapshots
            WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot_date}'
            AND parent_path IS NOT NULL
            AND parent_path != ''
        ),
        -- Pre-compute which paths are directories
        directory_paths AS (
            SELECT DISTINCT parent_path as dir_path
            FROM file_snapshots
            WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot_date}'
            AND parent_path IS NOT NULL
            AND parent_path != ''
        )
        SELECT
            '{snapshot_date}' as snapshot_date,
            ai.parent_path,
            ai.child_name,
            ai.path as child_path,
            -- Check if this path appears as a parent (i.e., it's a directory)
            CASE WHEN dp.dir_path IS NOT NULL THEN true ELSE false END as is_directory,
            SUM(ai.size) as total_size,
            COUNT(*) as file_count,
            MAX(ai.modified_time) as last_modified
        FROM all_items ai
        LEFT JOIN directory_paths dp ON ai.path = dp.dir_path
        GROUP BY ai.parent_path, ai.child_name, ai.path, dp.dir_path
    """)

    row_count = db.conn.execute(f"""
        SELECT COUNT(*) FROM directory_hierarchy
        WHERE snapshot_date = '{snapshot_date}'
    """).fetchone()[0]

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s ({row_count:,} parent-child relationships)")

    # 6. Create indexes for fast lookups
    logger.info("[6/7] Creating indexes...")
    start = time.time()

    # Index on parent_path for fast children lookups
    db.conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_hierarchy_parent
        ON directory_hierarchy(snapshot_date, parent_path)
    """)

    # Index on child_path for navigation
    db.conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_hierarchy_child
        ON directory_hierarchy(snapshot_date, child_path)
    """)

    # Note: Cannot create indexes on file_snapshots because it's a VIEW over Parquet files
    # DuckDB will use Parquet file metadata and columnar storage for efficient scans

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s")

    # 7. Run ANALYZE to update statistics
    logger.info("[7/7] Analyzing tables...")
    start = time.time()

    # Only analyze base tables, not views
    db.conn.execute("ANALYZE directory_hierarchy")
    db.conn.execute("ANALYZE snapshot_summary")
    db.conn.execute("ANALYZE directory_breakdown")
    db.conn.execute("ANALYZE filetype_breakdown")
    db.conn.execute("ANALYZE heavy_files")

    # Note: Cannot ANALYZE file_snapshots because it's a VIEW over Parquet files

    logger.info(f"  ✓ Completed in {time.time() - start:.2f}s")

    # Summary
    total_duration = time.time() - start_total
    logger.info("="  * 60)
    logger.info(f"Optimization complete in {total_duration:.2f}s")
    logger.info("")

    # Verify results
    result = db.conn.execute(f"""
        SELECT * FROM snapshot_summary WHERE date = '{snapshot_date}'
    """).fetchone()

    if result:
        logger.info("Summary:")
        logger.info(f"  Snapshot Date:    {result[0]}")
        logger.info(f"  Total Files:      {result[1]:,}")
        logger.info(f"  Total Size:       {result[2]:,} bytes ({result[2] / (1024**3):.2f} GB)")
        logger.info(f"  Top Level Dirs:   {len(result[3])}")

    db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/optimize_snapshot.py <snapshot_date>")
        print("Example: python scripts/optimize_snapshot.py 2025-12-11")
        sys.exit(1)

    snapshot_date = sys.argv[1]

    try:
        optimize_snapshot(snapshot_date)
    except Exception as e:
        logger.error(f"Error optimizing snapshot: {e}", exc_info=True)
        sys.exit(1)
