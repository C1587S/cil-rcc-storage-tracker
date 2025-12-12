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
            snapshot_path: Path to parquet snapshot file or glob pattern (e.g., 'path/to/*.parquet')
            target_directory: Optional target directory filter. If None or empty string, analyzes entire snapshot.
        """
        # Support glob patterns for multiple files
        if '*' in snapshot_path:
            self.snapshot_path = Path(snapshot_path).parent
            logger.info(f"Loading snapshots matching pattern: {snapshot_path}")
        else:
            self.snapshot_path = Path(snapshot_path)
            logger.info(f"Loading snapshot from {snapshot_path}")

        self.conn = duckdb.connect(':memory:')

        # Load parquet data - DuckDB supports glob patterns
        self.conn.execute(f"""
            CREATE VIEW files AS
            SELECT * FROM read_parquet('{snapshot_path}')
        """)

        # Auto-detect target directory if not provided
        if target_directory is None or target_directory == "":
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
            'total_size': main_stats['total_size'] or 0,
            'total_files': main_stats['total_files'] or 0,
            'subdirectory_count': main_stats['subdirectory_count'] or 0,
            'unique_file_types': main_stats['unique_file_types'] or 0,
            'predominant_types': predominant_types.to_dicts(),
            'heaviest_subdirectory': heaviest_dir.to_dicts()[0] if len(heaviest_dir) > 0 else None
        }

    def get_hierarchical_analysis(self, max_depth: int = 5) -> List[Dict[str, Any]]:
        """
        Section 2: Hierarchical Weight Analysis.

        Analyzes subdirectories at each level within the base directory.
        Level 1 = immediate children of base directory
        Level 2 = children of level 1 directories
        etc.

        Args:
            max_depth: Maximum depth to analyze

        Returns:
            List of dictionaries with hierarchical breakdown
        """
        logger.info("Performing hierarchical weight analysis")

        results = []
        base_path = self.target_directory.rstrip('/') if self.target_directory else ''
        base_parts = len([p for p in base_path.split('/') if p])  # Count non-empty parts

        for level in range(1, max_depth + 1):
            # Calculate target depth: base_parts + level
            # For example, if base is "/project/cil" (2 parts) and level is 1, target_depth is 3
            target_depth = base_parts + level

            # Build the query to extract folders at this specific depth level
            # We want to group by the partial path up to target_depth
            query = f"""
            WITH split_paths AS (
                SELECT
                    path,
                    size,
                    STRING_SPLIT(path, '/') as path_array,
                    ARRAY_LENGTH(STRING_SPLIT(path, '/')) as parts_count
                FROM files
                WHERE path LIKE '{base_path}/%'
                    AND path != '{base_path}'
            ),
            path_at_level AS (
                SELECT
                    ARRAY_TO_STRING(path_array[1:{target_depth + 1}], '/') as folder_path,
                    size,
                    parts_count
                FROM split_paths
                WHERE parts_count >= {target_depth}
            )
            SELECT
                folder_path,
                SUM(size) as total_size,
                COUNT(*) as file_count,
                {level} as depth_level
            FROM path_at_level
            GROUP BY folder_path
            ORDER BY total_size DESC
            LIMIT 20
            """

            try:
                depth_data = self.conn.execute(query).pl()

                if len(depth_data) > 0:
                    # Extract just the folder name (last component) for display
                    folders_list = []
                    for row in depth_data.to_dicts():
                        folder_path = row['folder_path']
                        folder_name = folder_path.split('/')[-1] if '/' in folder_path else folder_path

                        folders_list.append({
                            'folder_name': folder_name,
                            'full_path': folder_path,
                            'total_size': row['total_size'],
                            'file_count': row['file_count'],
                            'depth_level': row['depth_level']
                        })

                    results.append({
                        'depth': level,
                        'folders': folders_list
                    })

                    logger.info(f"  Level {level}: Found {len(folders_list)} folders")
            except Exception as e:
                logger.warning(f"Error analyzing level {level}: {e}")
                continue

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
        current_timestamp = now.timestamp()

        age_buckets = [
            ('0-30 days', 0, 30),
            ('31-90 days', 31, 90),
            ('91-180 days', 91, 180),
            ('6-12 months', 181, 365),
            ('Over 1 year', 366, 99999)
        ]

        results = []

        for bucket_name, min_days, max_days in age_buckets:
            # Calculate timestamp ranges (in seconds)
            min_timestamp = (now - timedelta(days=max_days)).timestamp()
            max_timestamp = (now - timedelta(days=min_days)).timestamp()

            query = f"""
            SELECT
                '{bucket_name}' as age_bucket,
                COUNT(*) as file_count,
                SUM(size) as total_size,
                LIST(DISTINCT file_type) as file_types
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND modified_time IS NOT NULL
                AND modified_time BETWEEN {min_timestamp} AND {max_timestamp}
            """

            bucket_data = self.conn.execute(query).pl().to_dicts()[0]
            results.append(bucket_data)

        # Old files by type (>1 year)
        old_timestamp = (now - timedelta(days=365)).timestamp()

        old_files_query = f"""
        SELECT
            file_type,
            COUNT(*) as file_count,
            SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND modified_time IS NOT NULL
            AND modified_time < {old_timestamp}
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
            AND modified_time IS NOT NULL
            AND modified_time < {old_timestamp}
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

        # Temporary and intermediate files - grouped by folder with full paths
        temp_files_by_folder_query = f"""
        WITH temp_with_rank AS (
            SELECT
                parent_path,
                path,
                size,
                ROW_NUMBER() OVER (PARTITION BY parent_path ORDER BY size DESC) as rn
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND (
                    path LIKE '%/tmp/%' OR
                    path LIKE '%/temp/%' OR
                    path LIKE '%temporary%' OR
                    file_type = 'tmp' OR
                    file_type = 'temp'
                )
        )
        SELECT
            parent_path as folder,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            LIST(path) FILTER (WHERE rn <= 5) as example_paths
        FROM temp_with_rank
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT 20
        """

        temp_files_by_folder = self.conn.execute(temp_files_by_folder_query).pl().to_dicts()

        # Also get total summary
        total_temp_count = sum(f['file_count'] for f in temp_files_by_folder)
        total_temp_size = sum(f['total_size'] for f in temp_files_by_folder)

        temp_files = {
            'temp_file_count': total_temp_count,
            'total_size': total_temp_size,
            'by_folder': temp_files_by_folder
        }

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

        hidden_files_result = self.conn.execute(hidden_query).pl().to_dicts()[0]
        hidden_files = {
            'hidden_file_count': hidden_files_result['hidden_file_count'] or 0,
            'total_size': hidden_files_result['total_size'] or 0,
            'file_types': hidden_files_result['file_types']
        }

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

        cache_files_result = self.conn.execute(cache_query).pl().to_dicts()[0]
        cache_files = {
            'cache_file_count': cache_files_result['cache_file_count'] or 0,
            'total_size': cache_files_result['total_size'] or 0
        }

        # Empty files - grouped by folder with examples
        empty_by_folder_query = f"""
        WITH empty_with_rank AS (
            SELECT
                parent_path,
                path,
                ROW_NUMBER() OVER (PARTITION BY parent_path ORDER BY path) as rn
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND size = 0
        )
        SELECT
            parent_path as folder,
            COUNT(*) as file_count,
            LIST(path) FILTER (WHERE rn <= 5) as example_paths
        FROM empty_with_rank
        GROUP BY parent_path
        ORDER BY file_count DESC
        LIMIT 15
        """

        empty_by_folder = self.conn.execute(empty_by_folder_query).pl().to_dicts()
        total_empty = sum(f['file_count'] for f in empty_by_folder)

        empty_files = {
            'empty_file_count': total_empty,
            'by_folder': empty_by_folder
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

        trash_files_result = self.conn.execute(trash_query).pl().to_dicts()[0]
        trash_files = {
            'trash_file_count': trash_files_result['trash_file_count'] or 0,
            'total_size': trash_files_result['total_size'] or 0
        }

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

    def get_file_type_locations(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        Get location breakdown for each significant file type.

        This helps answer: "Where are the nc4 files stored?"
        instead of just "How many nc4 files are there?"

        Returns:
            Dictionary mapping file types to their top folder locations
        """
        logger.info("Analyzing file type locations")

        # Get top file types by size
        top_types_query = f"""
        SELECT file_type, SUM(size) as total_size
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND file_type IS NOT NULL
            AND file_type != ''
        GROUP BY file_type
        ORDER BY total_size DESC
        LIMIT 10
        """

        top_types = self.conn.execute(top_types_query).pl().to_dicts()

        type_locations = {}

        for ft in top_types:
            file_type = ft['file_type']

            # Get top folders for this file type
            location_query = f"""
            SELECT
                parent_path as folder,
                COUNT(*) as file_count,
                SUM(size) as total_size
            FROM files
            WHERE path LIKE '{self.target_directory}%'
                AND file_type = '{file_type}'
            GROUP BY parent_path
            ORDER BY total_size DESC
            LIMIT 3
            """

            locations = self.conn.execute(location_query).pl().to_dicts()
            type_locations[file_type] = locations

        return type_locations

    def get_top_n_folders(self, n: int = 10) -> List[Dict[str, Any]]:
        """
        Get top N heaviest folders at any depth level.

        This replaces hierarchical analysis with a focused view of the largest folders.

        Args:
            n: Number of top folders to return

        Returns:
            List of top N folders with detailed analysis
        """
        logger.info(f"Identifying top {n} folders")

        # Get heaviest folders at any level
        query = f"""
        SELECT
            parent_path as path,
            SUM(size) as total_size,
            COUNT(*) as file_count,
            MAX(size) as largest_file,
            MAX(modified_time) as last_modified,
            MAX(accessed_time) as last_accessed,
            MIN(modified_time) as first_modified
        FROM files
        WHERE path LIKE '{self.target_directory}%'
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT {n}
        """

        top_folders = self.conn.execute(query).pl().to_dicts()

        # For each top folder, get detailed breakdown
        detailed_folders = []
        for folder in top_folders:
            folder_path = folder['path']

            # Get file type distribution
            type_query = f"""
            SELECT
                file_type,
                COUNT(*) as count,
                SUM(size) as total_size,
                AVG(size) as avg_size
            FROM files
            WHERE parent_path = '{folder_path}'
                AND file_type IS NOT NULL
            GROUP BY file_type
            ORDER BY total_size DESC
            LIMIT 5
            """

            file_types = self.conn.execute(type_query).pl().to_dicts()

            # Get age distribution for this folder
            now = datetime.now()
            age_query = f"""
            SELECT
                CASE
                    WHEN modified_time > {(now - timedelta(days=30)).timestamp()} THEN 'Last 30 days'
                    WHEN modified_time > {(now - timedelta(days=365)).timestamp()} THEN 'Last year'
                    ELSE 'Older than 1 year'
                END as age_bucket,
                COUNT(*) as file_count,
                SUM(size) as total_size
            FROM files
            WHERE parent_path = '{folder_path}'
                AND modified_time IS NOT NULL
            GROUP BY age_bucket
            """

            age_dist = self.conn.execute(age_query).pl().to_dicts()

            # Calculate access frequency (if accessed_time available)
            access_query = f"""
            SELECT
                COUNT(*) as total_files,
                COUNT(CASE WHEN accessed_time > {(now - timedelta(days=7)).timestamp()} THEN 1 END) as accessed_last_week,
                COUNT(CASE WHEN accessed_time > {(now - timedelta(days=30)).timestamp()} THEN 1 END) as accessed_last_month
            FROM files
            WHERE parent_path = '{folder_path}'
                AND accessed_time IS NOT NULL
            """

            access_stats = self.conn.execute(access_query).pl().to_dicts()[0]

            # Add detailed info
            folder['file_types'] = file_types
            folder['age_distribution'] = age_dist
            folder['access_stats'] = access_stats

            # Generate insight
            folder['insight'] = self._generate_folder_insight(folder)

            detailed_folders.append(folder)

        return detailed_folders

    def _generate_folder_insight(self, folder_data: Dict[str, Any]) -> str:
        """
        Generate a simple, actionable insight for a folder.

        Args:
            folder_data: Folder analysis data

        Returns:
            One or two sentence insight
        """
        total_size = folder_data.get('total_size', 0)
        file_count = folder_data.get('file_count', 0)
        access_stats = folder_data.get('access_stats', {})
        age_dist = folder_data.get('age_distribution', [])

        # Check if folder is active
        accessed_last_week = access_stats.get('accessed_last_week', 0)
        accessed_last_month = access_stats.get('accessed_last_month', 0)

        # Check if data is old
        old_data_size = sum(a.get('total_size', 0) for a in age_dist if a.get('age_bucket') == 'Older than 1 year')
        old_data_pct = (old_data_size / total_size * 100) if total_size > 0 else 0

        # Generate insight
        if accessed_last_week > file_count * 0.1:
            return "This folder is actively used. Do not archive."
        elif old_data_pct > 80 and accessed_last_month < file_count * 0.05:
            return "This folder contains old data with very little recent activity. Good candidate for archival."
        elif old_data_pct > 50:
            return "This folder contains mostly old data. Review usage patterns before archiving."
        elif total_size > 100 * 1024**3:  # > 100GB
            return "This is a very large folder. Review contents for cleanup opportunities."
        else:
            return "This folder shows normal usage patterns."

    def get_folder_activity_analysis(self) -> Dict[str, Any]:
        """
        Analyze folder access patterns and activity.

        This is critical for understanding which folders are actively used
        vs. which are candidates for archival.

        Returns:
            Dictionary with activity metrics per folder
        """
        logger.info("Analyzing folder access activity")

        # Most accessed folders
        accessed_query = f"""
        SELECT
            parent_path as folder,
            COUNT(*) as total_files,
            COUNT(CASE WHEN accessed_time IS NOT NULL THEN 1 END) as files_with_access_time,
            MAX(accessed_time) as last_access,
            AVG(accessed_time) as avg_access_time
        FROM files
        WHERE path LIKE '{self.target_directory}%'
        GROUP BY parent_path
        HAVING COUNT(CASE WHEN accessed_time IS NOT NULL THEN 1 END) > 0
        ORDER BY last_access DESC
        LIMIT 30
        """

        most_accessed = self.conn.execute(accessed_query).pl().to_dicts()

        # Folders with old files but recent access
        now = datetime.now()
        old_timestamp = (now - timedelta(days=365)).timestamp()
        recent_access = (now - timedelta(days=30)).timestamp()

        active_old_query = f"""
        SELECT
            parent_path as folder,
            COUNT(*) as file_count,
            SUM(size) as total_size,
            MAX(accessed_time) as last_access,
            MAX(modified_time) as last_modified
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND modified_time < {old_timestamp}
            AND accessed_time > {recent_access}
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT 20
        """

        active_old_folders = self.conn.execute(active_old_query).pl().to_dicts()

        # Cold folders (large but rarely accessed)
        cold_query = f"""
        SELECT
            parent_path as folder,
            SUM(size) as total_size,
            COUNT(*) as file_count,
            MAX(accessed_time) as last_access,
            MAX(modified_time) as last_modified
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND (accessed_time < {recent_access} OR accessed_time IS NULL)
            AND size > 1024 * 1024  -- Only files > 1MB
        GROUP BY parent_path
        HAVING SUM(size) > 1024 * 1024 * 1024  -- Folders > 1GB
        ORDER BY total_size DESC
        LIMIT 20
        """

        cold_folders = self.conn.execute(cold_query).pl().to_dicts()

        return {
            'most_accessed_folders': most_accessed,
            'active_old_folders': active_old_folders,
            'cold_folders': cold_folders
        }

    def get_snapshot_metadata(self) -> Dict[str, Any]:
        """
        Get metadata about the snapshot itself.

        Returns:
            Dictionary with snapshot date and other metadata
        """
        # Try to get snapshot date from file modification time
        snapshot_mtime = self.snapshot_path.stat().st_mtime
        snapshot_date = datetime.fromtimestamp(snapshot_mtime)

        # Get min/max timestamps from data
        metadata_query = f"""
        SELECT
            MIN(modified_time) as earliest_modified,
            MAX(modified_time) as latest_modified,
            MIN(accessed_time) as earliest_accessed,
            MAX(accessed_time) as latest_accessed
        FROM files
        WHERE path LIKE '{self.target_directory}%'
            AND modified_time IS NOT NULL
        """

        data_metadata = self.conn.execute(metadata_query).pl().to_dicts()[0]

        return {
            'snapshot_file_date': snapshot_date,
            'snapshot_path': str(self.snapshot_path),
            'earliest_file_modified': data_metadata.get('earliest_modified'),
            'latest_file_modified': data_metadata.get('latest_modified'),
            'earliest_file_accessed': data_metadata.get('earliest_accessed'),
            'latest_file_accessed': data_metadata.get('latest_accessed')
        }

    def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
