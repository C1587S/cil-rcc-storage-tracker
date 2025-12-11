"""Data analysis module for storage audit reports.

This module provides comprehensive analysis capabilities for parquet snapshot data,
extracting all metrics required for professional audit and cleaning reports.
"""

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import polars as pl
import duckdb

logger = logging.getLogger(__name__)


class StorageDataAnalyzer:
    """Analyzes storage snapshot data for comprehensive audit reporting."""

    def __init__(self, snapshot_path: str, target_directory: str = None):
        """
        Initialize the analyzer.

        Args:
            snapshot_path: Path to parquet snapshot file
            target_directory: Optional target directory filter. If None, analyzes entire snapshot.
        """
        self.snapshot_path = Path(snapshot_path)
        self.conn = duckdb.connect(':memory:')

        # Load parquet data
        logger.info(f"Loading snapshot from {snapshot_path}")
        self.conn.execute(f"""
            CREATE VIEW files AS
            SELECT * FROM read_parquet('{snapshot_path}')
        """)

        # Auto-detect target directory if not provided
        if target_directory is None:
            # Use empty string to match all files (no filtering)
            self.target_directory = ""
            logger.info("Analyzing all files in snapshot (no directory filter)")
        else:
            self.target_directory = target_directory.rstrip('/')
            logger.info(f"Analyzing directory: {target_directory}")

    def get_main_folder_analysis(self) -> Dict[str, Any]:
        """
        Section 1: Analysis of the Main Folder.

        Returns:
            Dictionary containing total size, file counts, predominant types, etc.
        """
        logger.info("Performing main folder analysis")

        query = f"""
        SELECT
            COUNT(*) as total_files,
            SUM(size) as total_size,
            COUNT(DISTINCT parent_path) as subdirectory_count,
            COUNT(DISTINCT file_type) as unique_file_types
        FROM files
        WHERE path LIKE '{self.target_directory}%'
        """

        main_stats = self.conn.execute(query).pl().to_dicts()[0]

        # Get predominant file types
        type_query = f"""
        SELECT
            file_type,
            COUNT(*) as count,
            SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND file_type IS NOT NULL
            AND file_type != ''
        GROUP BY file_type
        ORDER BY total_size DESC
        LIMIT 10
        """

        predominant_types = self.conn.execute(type_query).pl()

        # Get heaviest subdirectory
        heaviest_dir_query = f"""
        SELECT
            parent_path as directory,
            SUM(size) as total_size,
            COUNT(*) as file_count
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND parent_path != '{self.target_directory}'
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT 1
        """

        heaviest_dir = self.conn.execute(heaviest_dir_query).pl()

        return {
            'total_size': main_stats['total_size'],
            'total_files': main_stats['total_files'],
            'subdirectory_count': main_stats['subdirectory_count'],
            'unique_file_types': main_stats['unique_file_types'],
            'predominant_types': predominant_types.to_dicts(),
            'heaviest_subdirectory': heaviest_dir.to_dicts()[0] if len(heaviest_dir) > 0 else None
        }

    def get_hierarchical_analysis(self, max_depth: int = 5) -> List[Dict[str, Any]]:
        """
        Section 2: Hierarchical Weight Analysis.

        Args:
            max_depth: Maximum depth to analyze

        Returns:
            List of dictionaries with hierarchical breakdown
        """
        logger.info("Performing hierarchical weight analysis")

        results = []
        base_depth = self.target_directory.count('/')

        for depth in range(1, max_depth + 1):
            target_depth = base_depth + depth

            query = f"""
            WITH path_parts AS (
                SELECT
                    path,
                    size,
                    depth as file_depth,
                    split_part(path, '/', {target_depth + 1}) as folder_at_depth
                FROM files
                WHERE path LIKE '{self.target_directory}%'
                    AND depth >= {target_depth}
            )
            SELECT
                folder_at_depth as folder_name,
                SUM(size) as total_size,
                COUNT(*) as file_count,
                {depth} as depth_level
            FROM path_parts
            WHERE folder_at_depth != ''
            GROUP BY folder_at_depth
            ORDER BY total_size DESC
            LIMIT 20
            """

            depth_data = self.conn.execute(query).pl()

            if len(depth_data) > 0:
                results.append({
                    'depth': depth,
                    'folders': depth_data.to_dicts()
                })

        return results

    def get_hotspots(self) -> Dict[str, Any]:
        """
        Section 3: Hotspots (Critical Points).

        Returns:
            Dictionary with heaviest directories, largest files, and type consumption
        """
        logger.info("Identifying storage hotspots")

        # Heaviest subdirectories
        heavy_dirs_query = f"""
        SELECT
            parent_path as directory,
            SUM(size) as total_size,
            COUNT(*) as file_count,
            MAX(size) as largest_file
        FROM files
        WHERE path LIKE '{self.target_directory}%'
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT 50
        """

        heavy_dirs = self.conn.execute(heavy_dirs_query).pl()

        # Largest files
        largest_files_query = f"""
        SELECT
            path,
            size,
            file_type,
            modified_time,
            parent_path
        FROM files
        WHERE path LIKE '{self.target_directory}%'
        ORDER BY size DESC
        LIMIT 100
        """

        largest_files = self.conn.execute(largest_files_query).pl()

        # Files by size thresholds
        size_thresholds = {
            'over_10gb': 10 * 1024**3,
            'over_50gb': 50 * 1024**3,
            'over_100gb': 100 * 1024**3
        }

        threshold_counts = {}
        for threshold_name, threshold_size in size_thresholds.items():
            count_query = f"""
            WITH large_files AS (
                SELECT path, size
                FROM files
                WHERE path LIKE '{self.target_directory}%'
                    AND size > {threshold_size}
                ORDER BY size DESC
                LIMIT 10
            )
            SELECT
                (SELECT COUNT(*) FROM files WHERE path LIKE '{self.target_directory}%' AND size > {threshold_size}) as count,
                (SELECT SUM(size) FROM files WHERE path LIKE '{self.target_directory}%' AND size > {threshold_size}) as total_size,
                LIST(path) as top_files
            FROM large_files
            """

            result = self.conn.execute(count_query).pl()
            if len(result) > 0:
                # Aggregate the list from multiple rows
                threshold_counts[threshold_name] = {
                    'count': result['count'][0],
                    'total_size': result['total_size'][0],
                    'top_files': result['top_files'].to_list()
                }
            else:
                threshold_counts[threshold_name] = {
                    'count': 0,
                    'total_size': 0,
                    'top_files': []
                }

        # File types consuming most space
        type_consumption_query = f"""
        SELECT
            file_type,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            AVG(size) as avg_size,
            MAX(size) as max_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND file_type IS NOT NULL
            AND file_type != ''
        GROUP BY file_type
        ORDER BY total_size DESC
        LIMIT 20
        """

        type_consumption = self.conn.execute(type_consumption_query).pl()

        return {
            'heavy_directories': heavy_dirs.to_dicts(),
            'largest_files': largest_files.to_dicts(),
            'size_threshold_analysis': threshold_counts,
            'type_consumption': type_consumption.to_dicts()
        }

    def get_age_analysis(self) -> Dict[str, Any]:
        """
        Section 4: Age (Temporal) Analysis.

        Returns:
            Dictionary with files classified by age buckets
        """
        logger.info("Performing age analysis")

        now = datetime.now()
        age_buckets = [
            ('0-30 days', 0, 30),
            ('31-90 days', 31, 90),
            ('91-180 days', 91, 180),
            ('6-12 months', 181, 365),
            ('Over 1 year', 366, 99999)
        ]

        results = []

        for bucket_name, min_days, max_days in age_buckets:
            min_date = (now - timedelta(days=max_days)).isoformat()
            max_date = (now - timedelta(days=min_days)).isoformat()

            query = f"""
            SELECT
                '{bucket_name}' as age_bucket,
                COUNT(*) as file_count,
                SUM(size) as total_size,
                LIST(DISTINCT file_type) as file_types
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND TRY_CAST(modified_time AS TIMESTAMP) BETWEEN TRY_CAST('{min_date}' AS TIMESTAMP) AND TRY_CAST('{max_date}' AS TIMESTAMP)
            """

            bucket_data = self.conn.execute(query).pl().to_dicts()[0]
            results.append(bucket_data)

        # Old files by type
        old_files_query = f"""
        SELECT
            file_type,
            COUNT(*) as file_count,
            SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND TRY_CAST(modified_time AS TIMESTAMP) < TRY_CAST('{(now - timedelta(days=365)).isoformat()}' AS TIMESTAMP)
        GROUP BY file_type
        ORDER BY total_size DESC
        """

        old_files_by_type = self.conn.execute(old_files_query).pl()

        # Subdirectories with old content
        old_dirs_query = f"""
        SELECT
            parent_path as directory,
            COUNT(*) as old_file_count,
            SUM(size) as total_size,
            MAX(modified_time) as most_recent_modification
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND TRY_CAST(modified_time AS TIMESTAMP) < TRY_CAST('{(now - timedelta(days=365)).isoformat()}' AS TIMESTAMP)
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT 30
        """

        old_dirs = self.conn.execute(old_dirs_query).pl()

        return {
            'age_buckets': results,
            'old_files_by_type': old_files_by_type.to_dicts(),
            'directories_with_old_content': old_dirs.to_dicts()
        }

    def get_cleanup_opportunities(self) -> Dict[str, Any]:
        """
        Section 5: Cleanup / Reduction Opportunities.

        Returns:
            Dictionary with cleanup recommendations and priorities
        """
        logger.info("Identifying cleanup opportunities")

        opportunities = []

        # Find potential duplicates by size and name
        duplicates_query = f"""
        WITH file_groups AS (
            SELECT
                split_part(path, '/', length(regexp_split_to_array(path, '/'))) as filename,
                size,
                COUNT(*) as occurrence_count,
                SUM(size) as total_wasted,
                LIST(path) as file_locations
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND size > 1024 * 1024  -- Only files > 1MB
            GROUP BY filename, size
            HAVING COUNT(*) > 1
        )
        SELECT * FROM file_groups
        ORDER BY total_wasted DESC
        LIMIT 50
        """

        duplicates = self.conn.execute(duplicates_query).pl()

        # Checkpoint files
        checkpoint_query = f"""
        WITH ckpt_files AS (
            SELECT path, size
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND (
                    path LIKE '%checkpoint%' OR
                    path LIKE '%ckpt%' OR
                    file_type = 'ckpt' OR
                    file_type = 'pth'
                )
            ORDER BY size DESC
            LIMIT 10
        )
        SELECT
            (SELECT COUNT(*) FROM files WHERE path LIKE '{self.target_directory}%'
                AND (path LIKE '%checkpoint%' OR path LIKE '%ckpt%' OR file_type = 'ckpt' OR file_type = 'pth')) as checkpoint_count,
            (SELECT SUM(size) FROM files WHERE path LIKE '{self.target_directory}%'
                AND (path LIKE '%checkpoint%' OR path LIKE '%ckpt%' OR file_type = 'ckpt' OR file_type = 'pth')) as total_size,
            LIST(path) as largest_checkpoints
        FROM ckpt_files
        """

        result = self.conn.execute(checkpoint_query).pl()
        if len(result) > 0 and result['checkpoint_count'][0] is not None:
            checkpoints = {
                'checkpoint_count': result['checkpoint_count'][0],
                'total_size': result['total_size'][0] or 0,
                'largest_checkpoints': result['largest_checkpoints'].to_list()
            }
        else:
            checkpoints = {
                'checkpoint_count': 0,
                'total_size': 0,
                'largest_checkpoints': []
            }

        # Temporary and intermediate files
        temp_files_query = f"""
        SELECT
            COUNT(*) as temp_file_count,
            SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND (
                path LIKE '%/tmp/%' OR
                path LIKE '%/temp/%' OR
                path LIKE '%temporary%' OR
                file_type = 'tmp' OR
                file_type = 'temp'
            )
        """

        temp_files = self.conn.execute(temp_files_query).pl().to_dicts()[0]

        # Compressible files
        compressible_query = f"""
        SELECT
            file_type,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            SUM(size) * 0.7 as estimated_savings  -- Assume 30% compression
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND file_type IN ('log', 'txt', 'csv', 'json', 'xml', 'sql')
            AND size > 1024 * 1024  -- Files > 1MB
        GROUP BY file_type
        ORDER BY total_size DESC
        """

        compressible = self.conn.execute(compressible_query).pl()

        return {
            'potential_duplicates': duplicates.to_dicts(),
            'checkpoints': checkpoints,
            'temporary_files': temp_files,
            'compressible_files': compressible.to_dicts()
        }

    def get_user_analysis(self) -> Optional[Dict[str, Any]]:
        """
        Section 6: User / Homedir Analysis.

        Returns:
            Dictionary with per-user storage analysis (if applicable)
        """
        # Only applicable for home_dirs
        if 'home' not in self.target_directory.lower():
            return None

        logger.info("Performing user/homedir analysis")

        user_query = f"""
        WITH user_paths AS (
            SELECT
                split_part(path, '/', {self.target_directory.count('/') + 2}) as username,
                path,
                size,
                modified_time,
                accessed_time
            FROM files
            WHERE path LIKE '{self.target_directory}%'
        )
        SELECT
            username,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            MAX(accessed_time) as last_access,
            MAX(modified_time) as last_modification
        FROM user_paths
        WHERE username != ''
        GROUP BY username
        ORDER BY total_size DESC
        """

        user_stats = self.conn.execute(user_query).pl()

        # Inactive users
        inactive_query = f"""
        WITH user_paths AS (
            SELECT
                split_part(path, '/', {self.target_directory.count('/') + 2}) as username,
                size,
                accessed_time
            FROM files
            WHERE path LIKE '{self.target_directory}%'
        )
        SELECT
            username,
            SUM(size) as total_size,
            MAX(accessed_time) as last_access
        FROM user_paths
        WHERE username != ''
        GROUP BY username
        HAVING TRY_CAST(MAX(accessed_time) AS TIMESTAMP) < TRY_CAST('{(datetime.now() - timedelta(days=180)).isoformat()}' AS TIMESTAMP)
        ORDER BY total_size DESC
        """

        inactive_users = self.conn.execute(inactive_query).pl()

        return {
            'user_storage': user_stats.to_dicts(),
            'inactive_users': inactive_users.to_dicts()
        }

    def get_large_files_analysis(self) -> Dict[str, Any]:
        """
        Section 7: Analysis of Critically Large Files.

        Returns:
            Dictionary with files categorized by size thresholds
        """
        logger.info("Analyzing critically large files")

        thresholds = [
            ('10GB', 10 * 1024**3),
            ('50GB', 50 * 1024**3),
            ('100GB', 100 * 1024**3)
        ]

        results = {}

        for threshold_name, threshold_size in thresholds:
            query = f"""
            SELECT
                path,
                size,
                file_type,
                modified_time,
                parent_path,
                split_part(path, '/', length(regexp_split_to_array(path, '/'))) as filename
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND size > {threshold_size}
            ORDER BY size DESC
            """

            files = self.conn.execute(query).pl()
            results[threshold_name] = files.to_dicts()

        return results

    def get_trash_and_hidden_analysis(self) -> Dict[str, Any]:
        """
        Section 8: Trash, Hidden, and Residual Files Analysis.

        Returns:
            Dictionary with analysis of hidden files, trash, cache, etc.
        """
        logger.info("Analyzing trash, hidden, and residual files")

        # Hidden files (starting with .)
        hidden_query = f"""
        SELECT
            COUNT(*) as hidden_file_count,
            SUM(size) as total_size,
            LIST(DISTINCT file_type) as file_types
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND split_part(path, '/', length(regexp_split_to_array(path, '/'))) LIKE '.%'
        """

        hidden_files = self.conn.execute(hidden_query).pl().to_dicts()[0]

        # Cache directories
        cache_query = f"""
        SELECT
            COUNT(*) as cache_file_count,
            SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND (
                path LIKE '%/.cache/%' OR
                path LIKE '%/__pycache__/%' OR
                path LIKE '%/.ipynb_checkpoints/%' OR
                path LIKE '%/node_modules/%'
            )
        """

        cache_files = self.conn.execute(cache_query).pl().to_dicts()[0]

        # Empty files
        empty_files_query = f"""
        WITH empty_sample AS (
            SELECT path
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND size = 0
            LIMIT 100
        )
        SELECT
            (SELECT COUNT(*) FROM files WHERE path LIKE '{self.target_directory}%' AND size = 0) as empty_file_count,
            LIST(path) as sample_paths
        FROM empty_sample
        """

        result = self.conn.execute(empty_files_query).pl()
        if len(result) > 0:
            empty_files = {
                'empty_file_count': result['empty_file_count'][0] if result['empty_file_count'][0] is not None else 0,
                'sample_paths': result['sample_paths'].to_list() if len(result['sample_paths']) > 0 else []
            }
        else:
            empty_files = {
                'empty_file_count': 0,
                'sample_paths': []
            }

        # Trash folders
        trash_query = f"""
        SELECT
            COUNT(*) as trash_file_count,
            SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND (
                path LIKE '%/.Trash/%' OR
                path LIKE '%/trash/%' OR
                path LIKE '%/Trash/%'
            )
        """

        trash_files = self.conn.execute(trash_query).pl().to_dicts()[0]

        return {
            'hidden_files': hidden_files,
            'cache_files': cache_files,
            'empty_files': empty_files,
            'trash_files': trash_files
        }

    def get_file_type_classification(self) -> List[Dict[str, Any]]:
        """
        Section 11: File Type Classification.

        Returns:
            List of dictionaries with storage breakdown by category
        """
        logger.info("Performing file type classification")

        # Define categories
        categories = {
            'datasets': ['zarr', 'nc', 'h5', 'hdf5', 'dat', 'npy', 'npz'],
            'checkpoints': ['ckpt', 'pth', 'pt', 'pkl', 'pickle'],
            'logs': ['log', 'out', 'err'],
            'temporary': ['tmp', 'temp', 'swp', 'bak'],
            'environments': ['whl', 'egg', 'pyc'],
            'outputs': ['png', 'jpg', 'pdf', 'svg', 'mp4']
        }

        results = []

        for category, extensions in categories.items():
            ext_list = "', '".join(extensions)

            query = f"""
            SELECT
                '{category}' as category,
                COUNT(*) as file_count,
                SUM(size) as total_size,
                AVG(size) as avg_size,
                MAX(size) as max_size
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND file_type IN ('{ext_list}')
            """

            category_data = self.conn.execute(query).pl()

            if len(category_data) > 0 and category_data['file_count'][0] > 0:
                results.append(category_data.to_dicts()[0])

        # Other files
        all_categorized = []
        for exts in categories.values():
            all_categorized.extend(exts)

        ext_list = "', '".join(all_categorized)

        other_query = f"""
        SELECT
            'other' as category,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            AVG(size) as avg_size,
            MAX(size) as max_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND (file_type NOT IN ('{ext_list}') OR file_type IS NULL)
        """

        other_data = self.conn.execute(other_query).pl()
        if len(other_data) > 0:
            results.append(other_data.to_dicts()[0])

        return results

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
