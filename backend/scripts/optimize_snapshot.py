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
    """Create materialized summary tables for a snapshot."""

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
    logger.info("[1/4] Creating snapshot_summary table...")
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
    logger.info("[2/4] Creating directory_breakdown table...")
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
    logger.info("[3/4] Creating filetype_breakdown table...")
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
    logger.info("[4/4] Creating heavy_files table...")
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
