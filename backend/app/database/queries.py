"""Complex query builders for analytics."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class QueryBuilder:
    """Builder for complex analytics queries."""

    @staticmethod
    def build_treemap_query(
        path: str,
        snapshot: str,
        depth: int = 2,
        min_size: int = 1024
    ) -> str:
        """
        Build query for treemap visualization data.

        Args:
            path: Root path
            snapshot: Snapshot date
            depth: Maximum depth to include
            min_size: Minimum size threshold in bytes

        Returns:
            SQL query string
        """
        normalized_path = path.rstrip("/")
        target_depth = normalized_path.count("/") + depth

        query = f"""
            WITH RECURSIVE folder_tree AS (
                SELECT
                    path,
                    parent_path,
                    size,
                    depth,
                    file_type,
                    split_part(path, '/', depth + 1) as folder_name
                FROM file_snapshots
                WHERE path LIKE '{normalized_path}%'
                AND CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                AND depth <= {target_depth}
                AND size >= {min_size}
            )
            SELECT
                parent_path,
                folder_name as name,
                SUM(size) as value,
                COUNT(*) as file_count,
                MAX(file_type) as type
            FROM folder_tree
            WHERE folder_name != ''
            GROUP BY parent_path, folder_name
            ORDER BY value DESC
        """

        return query

    @staticmethod
    def build_timeline_query(
        path: Optional[str],
        start_date: str,
        end_date: str,
        metric: str = "size"
    ) -> str:
        """
        Build query for timeline visualization.

        Args:
            path: Optional path filter
            start_date: Start date
            end_date: End date
            metric: Metric to track ('size', 'count', 'types')

        Returns:
            SQL query string
        """
        path_filter = ""
        if path:
            path_filter = f"AND path LIKE '{path}%'"

        metric_expr = {
            "size": "SUM(size)",
            "count": "COUNT(*)",
            "types": "COUNT(DISTINCT file_type)"
        }.get(metric, "SUM(size)")

        query = f"""
            SELECT
                CAST(snapshot_date AS VARCHAR) as date,
                {metric_expr} as value
            FROM file_snapshots
            WHERE CAST(snapshot_date AS VARCHAR) >= '{start_date}'
            AND CAST(snapshot_date AS VARCHAR) <= '{end_date}'
            {path_filter}
            GROUP BY snapshot_date
            ORDER BY snapshot_date
        """

        return query

    @staticmethod
    def build_distribution_query(
        snapshot: str,
        dimension: str = "type",
        limit: int = 20
    ) -> str:
        """
        Build query for distribution analysis.

        Args:
            snapshot: Snapshot date
            dimension: Dimension to analyze ('type', 'size_bucket', 'depth')
            limit: Maximum categories to return

        Returns:
            SQL query string
        """
        if dimension == "type":
            group_expr = "file_type"
            label_expr = "file_type"
        elif dimension == "size_bucket":
            group_expr = """
                CASE
                    WHEN size < 1024 THEN '< 1 KB'
                    WHEN size < 1048576 THEN '1 KB - 1 MB'
                    WHEN size < 10485760 THEN '1 MB - 10 MB'
                    WHEN size < 104857600 THEN '10 MB - 100 MB'
                    WHEN size < 1073741824 THEN '100 MB - 1 GB'
                    ELSE '> 1 GB'
                END
            """
            label_expr = group_expr
        elif dimension == "depth":
            group_expr = "depth"
            label_expr = "CAST(depth AS VARCHAR)"
        else:
            group_expr = "file_type"
            label_expr = "file_type"

        query = f"""
            SELECT
                {label_expr} as label,
                COUNT(*) as count,
                SUM(size) as total_size,
                AVG(size) as avg_size
            FROM file_snapshots
            WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
            AND file_type != 'directory'
            GROUP BY {group_expr}
            ORDER BY total_size DESC
            LIMIT {limit}
        """

        return query

    @staticmethod
    def build_duplicate_candidates_query(
        snapshot: str,
        min_size: int = 1048576,
        limit: int = 100
    ) -> str:
        """
        Build query to find potential duplicate files.

        Args:
            snapshot: Snapshot date
            min_size: Minimum file size to consider
            limit: Maximum results

        Returns:
            SQL query string
        """
        query = f"""
            WITH size_groups AS (
                SELECT
                    size,
                    file_type,
                    COUNT(*) as file_count,
                    SUM(size) as total_size,
                    LIST(path) as paths
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                AND file_type != 'directory'
                AND size >= {min_size}
                GROUP BY size, file_type
                HAVING COUNT(*) > 1
            )
            SELECT
                size,
                file_type,
                file_count,
                total_size,
                total_size - size as wasted_space,
                paths
            FROM size_groups
            ORDER BY wasted_space DESC
            LIMIT {limit}
        """

        return query

    @staticmethod
    def build_growth_analysis_query(
        from_date: str,
        to_date: str,
        group_by: str = "top_level_dir"
    ) -> str:
        """
        Build query for storage growth analysis.

        Args:
            from_date: Start date
            to_date: End date
            group_by: Group dimension ('top_level_dir', 'file_type')

        Returns:
            SQL query string
        """
        query = f"""
            WITH from_data AS (
                SELECT
                    {group_by},
                    SUM(size) as size,
                    COUNT(*) as count
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{from_date}'
                GROUP BY {group_by}
            ),
            to_data AS (
                SELECT
                    {group_by},
                    SUM(size) as size,
                    COUNT(*) as count
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{to_date}'
                GROUP BY {group_by}
            )
            SELECT
                COALESCE(t.{group_by}, f.{group_by}) as category,
                COALESCE(f.size, 0) as from_size,
                COALESCE(t.size, 0) as to_size,
                COALESCE(t.size, 0) - COALESCE(f.size, 0) as size_change,
                COALESCE(f.count, 0) as from_count,
                COALESCE(t.count, 0) as to_count,
                COALESCE(t.count, 0) - COALESCE(f.count, 0) as count_change,
                CASE
                    WHEN COALESCE(f.size, 0) = 0 THEN 100.0
                    ELSE ((COALESCE(t.size, 0) - COALESCE(f.size, 0)) * 100.0 / f.size)
                END as growth_percentage
            FROM to_data t
            FULL OUTER JOIN from_data f ON t.{group_by} = f.{group_by}
            ORDER BY size_change DESC
        """

        return query
