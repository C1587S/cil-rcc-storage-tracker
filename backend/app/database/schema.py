"""Database schema initialization and management."""

import logging
from pathlib import Path
import duckdb

logger = logging.getLogger(__name__)


def init_schema(conn: duckdb.DuckDBPyConnection, snapshots_path: Path):
    """
    Initialize database schema.

    Args:
        conn: DuckDB connection
        snapshots_path: Path to parquet snapshots
    """
    logger.info("Initializing database schema")

    # Create aggregated views for better performance
    try:
        # Folder summaries for quick lookups
        conn.execute("""
            CREATE TABLE IF NOT EXISTS folder_summaries AS
            SELECT
                CAST(snapshot_date AS VARCHAR) as snapshot_date,
                parent_path,
                file_type,
                COUNT(*) as file_count,
                SUM(size) as total_size,
                MAX(size) as max_size,
                AVG(size) as avg_size,
                MAX(modified_time) as last_modified
            FROM read_parquet(
                'data/snapshots/**/*.parquet',
                hive_partitioning = true,
                union_by_name = true
            )
            GROUP BY snapshot_date, parent_path, file_type
        """)

        # Storage trends for time-series analysis
        conn.execute("""
            CREATE TABLE IF NOT EXISTS storage_trends AS
            SELECT
                CAST(snapshot_date AS VARCHAR) as snapshot_date,
                top_level_dir,
                SUM(size) as total_size,
                COUNT(*) as file_count,
                COUNT(DISTINCT file_type) as unique_types
            FROM read_parquet(
                'data/snapshots/**/*.parquet',
                hive_partitioning = true,
                union_by_name = true
            )
            GROUP BY snapshot_date, top_level_dir
            ORDER BY snapshot_date DESC
        """)

        logger.info("Schema initialized successfully")

    except Exception as e:
        logger.warning(f"Could not create aggregated tables (may need snapshots first): {e}")


def refresh_aggregations(conn: duckdb.DuckDBPyConnection):
    """
    Refresh aggregated tables with new snapshot data.

    Args:
        conn: DuckDB connection
    """
    logger.info("Refreshing aggregated tables")

    try:
        # Drop and recreate folder_summaries
        conn.execute("DROP TABLE IF EXISTS folder_summaries")
        conn.execute("""
            CREATE TABLE folder_summaries AS
            SELECT
                CAST(snapshot_date AS VARCHAR) as snapshot_date,
                parent_path,
                file_type,
                COUNT(*) as file_count,
                SUM(size) as total_size,
                MAX(size) as max_size,
                AVG(size) as avg_size,
                MAX(modified_time) as last_modified
            FROM read_parquet(
                'data/snapshots/**/*.parquet',
                hive_partitioning = true,
                union_by_name = true
            )
            GROUP BY snapshot_date, parent_path, file_type
        """)

        # Drop and recreate storage_trends
        conn.execute("DROP TABLE IF EXISTS storage_trends")
        conn.execute("""
            CREATE TABLE storage_trends AS
            SELECT
                CAST(snapshot_date AS VARCHAR) as snapshot_date,
                top_level_dir,
                SUM(size) as total_size,
                COUNT(*) as file_count,
                COUNT(DISTINCT file_type) as unique_types
            FROM read_parquet(
                'data/snapshots/**/*.parquet',
                hive_partitioning = true,
                union_by_name = true
            )
            GROUP BY snapshot_date, top_level_dir
            ORDER BY snapshot_date DESC
        """)

        logger.info("Aggregations refreshed successfully")

    except Exception as e:
        logger.error(f"Error refreshing aggregations: {e}")
