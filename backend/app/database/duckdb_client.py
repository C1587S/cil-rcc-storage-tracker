"""DuckDB client for querying parquet snapshots."""

import logging
from pathlib import Path
from typing import Any, Optional
import duckdb
import polars as pl

from app.config import get_settings

logger = logging.getLogger(__name__)


class DuckDBClient:
    """DuckDB client for storage analytics queries."""

    def __init__(self, db_path: Optional[str] = None, snapshots_path: Optional[str] = None):
        """
        Initialize DuckDB client.

        Args:
            db_path: Path to DuckDB database file (None for in-memory)
            snapshots_path: Path to parquet snapshots directory
        """
        settings = get_settings()

        # Use provided paths or resolve from settings with environment detection
        if db_path:
            self.db_path = db_path
        else:
            self.db_path = str(settings.get_absolute_db_path())

        if snapshots_path:
            self.snapshots_path = Path(snapshots_path)
        else:
            self.snapshots_path = settings.get_absolute_snapshots_path()

        # Create database connection
        self.conn = duckdb.connect(str(self.db_path) if self.db_path != ":memory:" else ":memory:")

        # Configure DuckDB for optimal performance (tuned for large datasets)
        self.conn.execute("SET threads TO 8")
        self.conn.execute("SET memory_limit = '8GB'")
        self.conn.execute("SET max_memory = '8GB'")

        logger.info(f"Environment: {settings.get_environment_name()}")
        logger.info(f"Data root: {settings.get_data_root()}")
        logger.info(f"DuckDB client initialized with database: {self.db_path}")
        logger.info(f"Snapshots path: {self.snapshots_path}")

        # Initialize schema
        self._init_views()

    def _init_views(self):
        """Initialize DuckDB views over parquet files."""
        try:
            # Create view over all parquet snapshots
            snapshot_pattern = str(self.snapshots_path / "**/*.parquet")

            # Extract snapshot date from directory structure
            # Path format: snapshots/YYYY-MM-DD/filename.parquet
            # Note: Explicitly select columns to avoid type conversion issues
            self.conn.execute(f"""
                CREATE OR REPLACE VIEW file_snapshots AS
                SELECT
                    path,
                    size,
                    modified_time,
                    accessed_time,
                    created_time,
                    file_type,
                    inode,
                    permissions,
                    parent_path,
                    depth,
                    top_level_dir,
                    regexp_extract(filename, 'snapshots/([^/]+)/', 1) as snapshot_date
                FROM read_parquet(
                    '{snapshot_pattern}',
                    union_by_name = true,
                    filename = true
                )
            """)

            logger.info("DuckDB views initialized successfully")
        except Exception as e:
            logger.warning(f"Could not initialize views (snapshots may not exist yet): {e}")

    def list_snapshots(self) -> list[dict[str, Any]]:
        """
        List all available snapshots.

        Returns:
            List of snapshot information dictionaries
        """
        try:
            import time
            start = time.time()

            # Try materialized summary table first (instant for large datasets)
            try:
                query = """
                    SELECT
                        date,
                        file_count,
                        total_size,
                        top_level_dirs
                    FROM snapshot_summary
                    ORDER BY date DESC
                """
                result = self.conn.execute(query).pl()
                snapshots = result.to_dicts()

                if len(snapshots) > 0:
                    duration = time.time() - start
                    logger.info(f"list_snapshots (materialized) completed in {duration:.3f}s")
                    return snapshots
            except Exception:
                logger.warning("Materialized snapshot_summary table not found, using full scan")

            # Fallback: Full scan (slow for 1M+ files)
            query = """
                SELECT
                    CAST(snapshot_date AS VARCHAR) as date,
                    COUNT(*) as file_count,
                    SUM(size) as total_size
                FROM file_snapshots
                GROUP BY snapshot_date
                ORDER BY snapshot_date DESC
            """

            result = self.conn.execute(query).pl()
            snapshots = result.to_dicts()

            # Get top_level_dirs separately
            # Use the top_level_dir column from scanner data and construct full paths
            for snapshot in snapshots:
                dirs_query = f"""
                    SELECT DISTINCT top_level_dir
                    FROM file_snapshots
                    WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot['date']}'
                    ORDER BY top_level_dir
                    LIMIT 100
                """
                dirs_result = self.conn.execute(dirs_query).pl()
                # Convert top_level_dir names to full paths by finding an example path for each
                top_dirs = dirs_result['top_level_dir'].to_list() if len(dirs_result) > 0 else []
                full_paths = []
                for top_dir in top_dirs:
                    # Get one example path for this top_level_dir to extract the full directory path
                    path_query = f"""
                        SELECT path
                        FROM file_snapshots
                        WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot['date']}'
                        AND top_level_dir = '{top_dir}'
                        LIMIT 1
                    """
                    path_result = self.conn.execute(path_query).pl()
                    if len(path_result) > 0:
                        example_path = path_result['path'][0]
                        # Extract first-level directory: /project/cil/gcp or /project/cil/battuta_shares etc
                        parts = example_path.split('/')
                        if len(parts) >= 4:
                            full_path = '/' + '/'.join(parts[1:4])  # /project/cil/xxx
                            if full_path not in full_paths:
                                full_paths.append(full_path)
                snapshot['top_level_dirs'] = sorted(full_paths)

            duration = time.time() - start
            logger.warning(f"list_snapshots (full scan) took {duration:.2f}s - run optimize_snapshot.py for better performance")
            return snapshots

        except Exception as e:
            logger.error(f"Error listing snapshots: {e}")
            return []

    def get_snapshot_info(self, snapshot_date: str) -> Optional[dict[str, Any]]:
        """
        Get detailed information about a specific snapshot.

        Args:
            snapshot_date: Snapshot date (YYYY-MM-DD)

        Returns:
            Snapshot information dictionary or None
        """
        try:
            query = """
                SELECT
                    CAST(snapshot_date AS VARCHAR) as date,
                    COUNT(*) as file_count,
                    SUM(size) as total_size,
                    MAX(modified_time) as last_modified
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = ?
                GROUP BY snapshot_date
            """

            result = self.conn.execute(query, [snapshot_date]).pl()

            if len(result) == 0:
                return None

            snapshot_info = result.to_dicts()[0]

            # Get top_level_dirs by extracting from actual paths
            dirs_query = """
                SELECT DISTINCT top_level_dir
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = ?
                ORDER BY top_level_dir
            """
            dirs_result = self.conn.execute(dirs_query, [snapshot_date]).pl()
            top_dirs = dirs_result['top_level_dir'].to_list() if len(dirs_result) > 0 else []

            # Convert to full paths
            full_paths = []
            for top_dir in top_dirs:
                path_query = """
                    SELECT path
                    FROM file_snapshots
                    WHERE CAST(snapshot_date AS VARCHAR) = ?
                    AND top_level_dir = ?
                    LIMIT 1
                """
                path_result = self.conn.execute(path_query, [snapshot_date, top_dir]).pl()
                if len(path_result) > 0:
                    example_path = path_result['path'][0]
                    parts = example_path.split('/')
                    if len(parts) >= 4:
                        full_path = '/' + '/'.join(parts[1:4])
                        if full_path not in full_paths:
                            full_paths.append(full_path)

            snapshot_info['top_level_dirs'] = sorted(full_paths)
            return snapshot_info
        except Exception as e:
            logger.error(f"Error getting snapshot info: {e}")
            return None

    def search_files(
        self,
        pattern: str,
        snapshot: Optional[str] = None,
        regex: bool = True,
        limit: int = 1000
    ) -> pl.DataFrame:
        """
        Search for files matching a pattern.

        Args:
            pattern: Search pattern (glob or regex)
            snapshot: Specific snapshot to search (None for latest)
            regex: Use regex matching (False for glob)
            limit: Maximum results to return

        Returns:
            Polars DataFrame with matching files
        """
        try:
            snapshot_filter = ""
            if snapshot:
                snapshot_filter = f"AND CAST(snapshot_date AS VARCHAR) = '{snapshot}'"

            if regex:
                match_condition = f"regexp_matches(path, '{pattern}')"
            else:
                # Convert glob to SQL LIKE pattern
                like_pattern = pattern.replace("*", "%").replace("?", "_")
                match_condition = f"path LIKE '{like_pattern}'"

            query = f"""
                SELECT
                    path,
                    size,
                    modified_time,
                    accessed_time,
                    created_time,
                    file_type,
                    inode,
                    permissions,
                    parent_path,
                    depth,
                    top_level_dir,
                    CAST(snapshot_date AS VARCHAR) as snapshot_date
                FROM file_snapshots
                WHERE {match_condition}
                {snapshot_filter}
                ORDER BY size DESC
                LIMIT {limit}
            """

            result = self.conn.execute(query).pl()
            logger.info(f"Search found {len(result)} results for pattern: {pattern}")
            return result

        except Exception as e:
            logger.error(f"Error searching files: {e}")
            return pl.DataFrame()

    def get_folder_breakdown(
        self,
        path: str,
        snapshot: str,
        depth: int = 1,
        group_by: str = "directory"
    ) -> pl.DataFrame:
        """
        Get folder breakdown with size information.

        Args:
            path: Folder path to analyze
            snapshot: Snapshot date
            depth: Directory depth to analyze
            group_by: Group by 'directory' or 'type'

        Returns:
            Polars DataFrame with breakdown
        """
        try:
            # Normalize path
            path = path.rstrip("/")
            target_depth = path.count("/") + depth

            if group_by == "type":
                query = f"""
                    SELECT
                        file_type,
                        COUNT(*) as file_count,
                        SUM(size) as total_size,
                        MAX(size) as max_size,
                        AVG(size) as avg_size,
                        MAX(modified_time) as last_modified
                    FROM file_snapshots
                    WHERE parent_path LIKE '{path}%'
                    AND CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                    GROUP BY file_type
                    ORDER BY total_size DESC
                """
            else:
                query = f"""
                    WITH folder_paths AS (
                        SELECT
                            path,
                            parent_path,
                            size,
                            modified_time,
                            file_type,
                            depth,
                            CASE
                                WHEN depth <= {target_depth} THEN
                                    split_part(path, '/', {target_depth + 1})
                                ELSE path
                            END as folder_name,
                            -- Use file_type to determine if directory
                            (file_type = 'directory') as is_directory
                        FROM file_snapshots
                        WHERE path LIKE '{path}%'
                        AND CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                    )
                    SELECT
                        folder_name as name,
                        COUNT(*) as file_count,
                        SUM(size) as total_size,
                        MAX(size) as max_size,
                        MAX(modified_time) as last_modified,
                        COUNT(DISTINCT file_type) as type_count,
                        BOOL_OR(is_directory) as is_directory
                    FROM folder_paths
                    WHERE folder_name != ''
                    GROUP BY folder_name
                    ORDER BY total_size DESC
                """

            result = self.conn.execute(query).pl()
            logger.info(f"Folder breakdown for {path} returned {len(result)} items")
            return result

        except Exception as e:
            logger.error(f"Error getting folder breakdown: {e}")
            return pl.DataFrame()

    def get_immediate_children(
        self,
        path: str,
        snapshot: str
    ) -> pl.DataFrame:
        """
        Get immediate children of a folder (both files and subdirectories).
        Uses pre-computed directory_hierarchy table for O(1) lookup instead of O(n²).

        Args:
            path: Parent folder path
            snapshot: Snapshot date

        Returns:
            Polars DataFrame with immediate children
        """
        try:
            import time
            start = time.time()

            # Normalize path
            path = path.rstrip("/")
            if not path:
                path = "/"

            # Try using pre-computed hierarchy table first (instant for large datasets)
            try:
                query = f"""
                    SELECT
                        child_name as name,
                        total_size,
                        file_count,
                        last_modified,
                        is_directory
                    FROM directory_hierarchy
                    WHERE snapshot_date = '{snapshot}'
                    AND parent_path = '{path}'
                    ORDER BY total_size DESC
                """

                result = self.conn.execute(query).pl()

                if len(result) > 0 or self._hierarchy_table_exists(snapshot):
                    duration = time.time() - start
                    logger.info(f"Immediate children for {path} (materialized): {len(result)} items in {duration:.3f}s")
                    return result

            except Exception as e:
                logger.warning(f"Could not use materialized hierarchy table: {e}")

            # Fallback to original query (slow for 1M+ files)
            logger.warning(f"Using fallback query for {path} - run optimize_snapshot.py for better performance")
            query = f"""
                WITH immediate_items AS (
                    SELECT DISTINCT
                        path,
                        parent_path,
                        size,
                        modified_time,
                        file_type,
                        -- Extract just the name (last part of the path)
                        split_part(path, '/', length(regexp_split_to_array(path, '/'))) as name,
                        -- Use file_type to determine if directory
                        (file_type = 'directory') as is_directory
                    FROM file_snapshots
                    WHERE parent_path = '{path}'
                    AND CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                )
                SELECT
                    name,
                    SUM(size) as total_size,
                    COUNT(*) as file_count,
                    MAX(modified_time) as last_modified,
                    BOOL_OR(is_directory) as is_directory
                FROM immediate_items
                GROUP BY name
                ORDER BY total_size DESC
            """

            result = self.conn.execute(query).pl()
            duration = time.time() - start
            logger.warning(f"Immediate children for {path} (full scan) took {duration:.2f}s")
            return result

        except Exception as e:
            logger.error(f"Error getting immediate children: {e}")
            return pl.DataFrame()

    def _hierarchy_table_exists(self, snapshot: str) -> bool:
        """Check if directory_hierarchy table exists and has data for this snapshot."""
        try:
            result = self.conn.execute(f"""
                SELECT COUNT(*) as count
                FROM directory_hierarchy
                WHERE snapshot_date = '{snapshot}'
                LIMIT 1
            """).fetchone()
            return result is not None and result[0] > 0
        except Exception:
            return False

    def get_heavy_files(
        self,
        snapshot: str,
        limit: int = 100,
        path_filter: Optional[str] = None
    ) -> pl.DataFrame:
        """
        Get largest files in a snapshot.

        Args:
            snapshot: Snapshot date
            limit: Number of files to return
            path_filter: Optional path prefix filter

        Returns:
            Polars DataFrame with heavy files
        """
        try:
            path_condition = ""
            if path_filter:
                path_condition = f"AND path LIKE '{path_filter}%'"

            query = f"""
                SELECT
                    path,
                    size,
                    modified_time,
                    accessed_time,
                    file_type,
                    parent_path,
                    top_level_dir
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                AND file_type != 'directory'
                {path_condition}
                ORDER BY size DESC
                LIMIT {limit}
            """

            result = self.conn.execute(query).pl()
            logger.info(f"Retrieved {len(result)} heavy files")
            return result

        except Exception as e:
            logger.error(f"Error getting heavy files: {e}")
            return pl.DataFrame()

    def get_inactive_files(
        self,
        snapshot: str,
        days: int = 365,
        limit: int = 100
    ) -> pl.DataFrame:
        """
        Get files not accessed in specified days.

        Args:
            snapshot: Snapshot date
            days: Number of days threshold
            limit: Maximum results

        Returns:
            Polars DataFrame with inactive files
        """
        try:
            query = f"""
                SELECT
                    path,
                    size,
                    accessed_time,
                    modified_time,
                    file_type,
                    parent_path,
                    CAST(CURRENT_DATE - CAST(accessed_time AS DATE) AS INTEGER) as days_since_access
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                AND file_type != 'directory'
                AND CAST(CURRENT_DATE - CAST(accessed_time AS DATE) AS INTEGER) >= {days}
                ORDER BY size DESC
                LIMIT {limit}
            """

            result = self.conn.execute(query).pl()
            logger.info(f"Found {len(result)} inactive files")
            return result

        except Exception as e:
            logger.error(f"Error getting inactive files: {e}")
            return pl.DataFrame()

    def get_recent_activity(
        self,
        snapshot: str,
        limit: int = 100
    ) -> pl.DataFrame:
        """
        Get recently modified files.

        Args:
            snapshot: Snapshot date
            limit: Maximum results

        Returns:
            Polars DataFrame with recent files
        """
        try:
            query = f"""
                SELECT
                    path,
                    size,
                    modified_time,
                    accessed_time,
                    file_type,
                    parent_path
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                AND file_type != 'directory'
                ORDER BY modified_time DESC
                LIMIT {limit}
            """

            result = self.conn.execute(query).pl()
            logger.info(f"Retrieved {len(result)} recently modified files")
            return result

        except Exception as e:
            logger.error(f"Error getting recent activity: {e}")
            return pl.DataFrame()

    def compare_snapshots(
        self,
        from_date: str,
        to_date: str
    ) -> dict[str, Any]:
        """
        Compare two snapshots.

        Args:
            from_date: Earlier snapshot date
            to_date: Later snapshot date

        Returns:
            Dictionary with comparison statistics
        """
        try:
            query = f"""
                WITH from_snapshot AS (
                    SELECT path, size, modified_time
                    FROM file_snapshots
                    WHERE CAST(snapshot_date AS VARCHAR) = '{from_date}'
                ),
                to_snapshot AS (
                    SELECT path, size, modified_time
                    FROM file_snapshots
                    WHERE CAST(snapshot_date AS VARCHAR) = '{to_date}'
                )
                SELECT
                    (SELECT COUNT(*) FROM to_snapshot) - (SELECT COUNT(*) FROM from_snapshot) as file_count_change,
                    (SELECT SUM(size) FROM to_snapshot) - (SELECT SUM(size) FROM from_snapshot) as size_change,
                    (SELECT COUNT(*) FROM to_snapshot WHERE path NOT IN (SELECT path FROM from_snapshot)) as files_added,
                    (SELECT COUNT(*) FROM from_snapshot WHERE path NOT IN (SELECT path FROM to_snapshot)) as files_removed,
                    (SELECT COUNT(*) FROM to_snapshot t
                     JOIN from_snapshot f ON t.path = f.path
                     WHERE t.modified_time != f.modified_time) as files_modified
            """

            result = self.conn.execute(query).pl()

            if len(result) == 0:
                return {}

            comparison = result.to_dicts()[0]
            logger.info(f"Snapshot comparison: {comparison}")
            return comparison

        except Exception as e:
            logger.error(f"Error comparing snapshots: {e}")
            return {}

    def get_file_history(self, file_path: str) -> pl.DataFrame:
        """
        Get history of a specific file across snapshots.

        Args:
            file_path: Full file path

        Returns:
            Polars DataFrame with file history
        """
        try:
            query = f"""
                SELECT
                    CAST(snapshot_date AS VARCHAR) as snapshot_date,
                    size,
                    modified_time,
                    accessed_time
                FROM file_snapshots
                WHERE path = '{file_path}'
                ORDER BY snapshot_date DESC
            """

            result = self.conn.execute(query).pl()
            logger.info(f"Retrieved history for {file_path}: {len(result)} snapshots")
            return result

        except Exception as e:
            logger.error(f"Error getting file history: {e}")
            return pl.DataFrame()

    def execute_raw_query(self, query: str, params: Optional[list] = None) -> pl.DataFrame:
        """
        Execute a raw SQL query.

        Args:
            query: SQL query string
            params: Optional query parameters

        Returns:
            Polars DataFrame with results
        """
        try:
            if params:
                result = self.conn.execute(query, params).pl()
            else:
                result = self.conn.execute(query).pl()
            return result
        except Exception as e:
            logger.error(f"Error executing query: {e}")
            return pl.DataFrame()

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
            logger.info("DuckDB connection closed")
