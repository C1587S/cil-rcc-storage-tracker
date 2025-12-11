"""Directory-level analysis module for multi-level storage reports.

This module provides comprehensive per-directory analysis at multiple depth levels,
including visualizations for each directory analyzed.
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
import duckdb
from datetime import datetime
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for server use
import matplotlib.pyplot as plt
import seaborn as sns
import io
import base64

logger = logging.getLogger(__name__)

# Set professional style for plots
sns.set_style("whitegrid")
plt.rcParams['figure.figsize'] = (10, 6)
plt.rcParams['font.size'] = 10


class DirectoryAnalyzer:
    """Analyzes individual directories at any depth level."""

    def __init__(self, conn: duckdb.DuckDBPyConnection):
        """
        Initialize directory analyzer.

        Args:
            conn: DuckDB connection with loaded snapshot data
        """
        self.conn = conn

    def get_subdirectories(self, parent_path: str, depth: int = 1) -> List[str]:
        """
        Get all immediate subdirectories at specified depth.

        Args:
            parent_path: Parent directory path
            depth: Depth level (1 for immediate children, 2 for grandchildren)

        Returns:
            List of subdirectory paths
        """
        if parent_path == "" or parent_path == "/":
            # Root level - get top-level directories
            query = """
            SELECT DISTINCT
                SPLIT_PART(path, '/', 2) as subdir
            FROM files
            WHERE path LIKE '/%'
                AND SPLIT_PART(path, '/', 2) != ''
            ORDER BY subdir
            """
        else:
            parent_clean = parent_path.rstrip('/')
            # Count slashes to determine depth
            parent_depth = len([c for c in parent_clean if c == '/'])
            target_depth = parent_depth + depth

            query = f"""
            WITH path_parts AS (
                SELECT
                    path,
                    STRING_SPLIT(path, '/') as parts,
                    ARRAY_LENGTH(STRING_SPLIT(path, '/')) as depth
                FROM files
                WHERE path LIKE '{parent_clean}/%'
            )
            SELECT DISTINCT
                ARRAY_TO_STRING(parts[1:{target_depth + 1}], '/') as subdir
            FROM path_parts
            WHERE depth > {parent_depth}
            ORDER BY subdir
            """

        try:
            result = self.conn.execute(query).fetchall()
            subdirs = [row[0] for row in result if row[0]]
            logger.info(f"Found {len(subdirs)} subdirectories in {parent_path or 'root'}")
            return subdirs
        except Exception as e:
            logger.error(f"Error getting subdirectories for {parent_path}: {e}")
            return []

    def analyze_directory(self, directory_path: str) -> Dict[str, Any]:
        """
        Comprehensive analysis of a single directory.

        Args:
            directory_path: Path to analyze

        Returns:
            Dictionary with all analysis results and visualizations
        """
        logger.info(f"Analyzing directory: {directory_path}")

        analysis = {
            'path': directory_path,
            'basic_stats': self._get_basic_stats(directory_path),
            'largest_files': self._get_largest_files(directory_path),
            'largest_subfolders': self._get_largest_subfolders(directory_path),
            'file_type_distribution': self._get_file_type_distribution(directory_path),
            'timestamps': self._get_timestamp_info(directory_path),
            'age_buckets': self._get_age_buckets(directory_path),
            'visualizations': {}
        }

        # Generate visualizations
        analysis['visualizations'] = {
            'file_type_chart': self._create_file_type_chart(analysis['file_type_distribution']),
            'size_histogram': self._create_size_histogram(directory_path),
            'age_heatmap': self._create_age_heatmap(analysis['age_buckets']),
            'subfolder_bar_chart': self._create_subfolder_chart(analysis['largest_subfolders'])
        }

        return analysis

    def _get_basic_stats(self, directory_path: str) -> Dict[str, Any]:
        """Get basic statistics for directory."""
        query = f"""
        SELECT
            COUNT(*) as total_files,
            SUM(size) as total_size,
            AVG(size) as avg_size,
            MAX(size) as max_size,
            MIN(size) as min_size,
            COUNT(DISTINCT file_type) as unique_types
        FROM files
        WHERE path LIKE '{directory_path}/%'
            OR parent_path = '{directory_path}'
        """

        result = self.conn.execute(query).fetchone()
        return {
            'total_files': result[0] or 0,
            'total_size': float(result[1] or 0),
            'avg_size': float(result[2] or 0),
            'max_size': float(result[3] or 0),
            'min_size': float(result[4] or 0),
            'unique_types': result[5] or 0
        }

    def _get_largest_files(self, directory_path: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Get largest files in directory."""
        query = f"""
        SELECT
            path,
            size,
            file_type,
            modified_time,
            accessed_time
        FROM files
        WHERE (path LIKE '{directory_path}/%' OR parent_path = '{directory_path}')
        ORDER BY size DESC
        LIMIT {limit}
        """

        result = self.conn.execute(query).fetchall()
        return [
            {
                'path': row[0],
                'size': float(row[1]),
                'file_type': row[2] or 'unknown',
                'modified_time': row[3],
                'accessed_time': row[4]
            }
            for row in result
        ]

    def _get_largest_subfolders(self, directory_path: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get largest immediate subfolders."""
        query = f"""
        SELECT
            parent_path as subfolder,
            COUNT(*) as file_count,
            SUM(size) as total_size
        FROM files
        WHERE parent_path LIKE '{directory_path}/%'
            AND parent_path != '{directory_path}'
        GROUP BY parent_path
        ORDER BY total_size DESC
        LIMIT {limit}
        """

        result = self.conn.execute(query).fetchall()
        return [
            {
                'path': row[0],
                'file_count': row[1],
                'total_size': float(row[2])
            }
            for row in result
        ]

    def _get_file_type_distribution(self, directory_path: str) -> List[Dict[str, Any]]:
        """Get file type distribution."""
        query = f"""
        SELECT
            file_type,
            COUNT(*) as count,
            SUM(size) as total_size,
            AVG(size) as avg_size
        FROM files
        WHERE (path LIKE '{directory_path}/%' OR parent_path = '{directory_path}')
            AND file_type IS NOT NULL
            AND file_type != ''
        GROUP BY file_type
        ORDER BY total_size DESC
        LIMIT 20
        """

        result = self.conn.execute(query).fetchall()
        return [
            {
                'type': row[0],
                'count': row[1],
                'total_size': float(row[2]),
                'avg_size': float(row[3])
            }
            for row in result
        ]

    def _get_timestamp_info(self, directory_path: str) -> Dict[str, Any]:
        """Get timestamp information (last modified, last accessed)."""
        query = f"""
        SELECT
            MAX(modified_time) as last_modified,
            MIN(modified_time) as first_modified,
            MAX(accessed_time) as last_accessed,
            MIN(accessed_time) as first_accessed
        FROM files
        WHERE (path LIKE '{directory_path}/%' OR parent_path = '{directory_path}')
        """

        result = self.conn.execute(query).fetchone()
        return {
            'last_modified': result[0],
            'first_modified': result[1],
            'last_accessed': result[2],
            'first_accessed': result[3]
        }

    def _get_age_buckets(self, directory_path: str) -> List[Dict[str, Any]]:
        """Get file age distribution in buckets."""
        current_time = datetime.now().timestamp()

        query = f"""
        SELECT
            CASE
                WHEN {current_time} - modified_time <= 30 * 86400 THEN '0-30 days'
                WHEN {current_time} - modified_time <= 90 * 86400 THEN '31-90 days'
                WHEN {current_time} - modified_time <= 180 * 86400 THEN '91-180 days'
                WHEN {current_time} - modified_time <= 365 * 86400 THEN '6-12 months'
                ELSE 'Over 1 year'
            END as age_bucket,
            COUNT(*) as file_count,
            SUM(size) as total_size
        FROM files
        WHERE (path LIKE '{directory_path}/%' OR parent_path = '{directory_path}')
            AND modified_time IS NOT NULL
        GROUP BY age_bucket
        ORDER BY
            CASE age_bucket
                WHEN '0-30 days' THEN 1
                WHEN '31-90 days' THEN 2
                WHEN '91-180 days' THEN 3
                WHEN '6-12 months' THEN 4
                ELSE 5
            END
        """

        result = self.conn.execute(query).fetchall()
        return [
            {
                'bucket': row[0],
                'file_count': row[1],
                'total_size': float(row[2])
            }
            for row in result
        ]

    def _create_file_type_chart(self, type_distribution: List[Dict[str, Any]]) -> str:
        """Create bar chart for file type distribution."""
        if not type_distribution:
            return ""

        try:
            # Take top 10 for readability
            top_types = type_distribution[:10]
            types = [item['type'] for item in top_types]
            sizes = [item['total_size'] / (1024**3) for item in top_types]  # Convert to GB

            fig, ax = plt.subplots(figsize=(10, 6))
            bars = ax.barh(types, sizes, color=sns.color_palette("viridis", len(types)))
            ax.set_xlabel('Size (GB)', fontsize=12)
            ax.set_ylabel('File Type', fontsize=12)
            ax.set_title('File Type Distribution by Size', fontsize=14, fontweight='bold')
            ax.invert_yaxis()  # Largest at top

            # Add value labels
            for i, (bar, size) in enumerate(zip(bars, sizes)):
                width = bar.get_width()
                ax.text(width, bar.get_y() + bar.get_height()/2,
                       f' {size:.2f} GB',
                       ha='left', va='center', fontsize=9)

            plt.tight_layout()
            return self._fig_to_base64(fig)
        except Exception as e:
            logger.error(f"Error creating file type chart: {e}")
            return ""

    def _create_size_histogram(self, directory_path: str) -> str:
        """Create histogram of file sizes."""
        try:
            query = f"""
            SELECT size
            FROM files
            WHERE (path LIKE '{directory_path}/%' OR parent_path = '{directory_path}')
                AND size > 0
            """

            result = self.conn.execute(query).fetchall()
            if not result:
                return ""

            sizes = [float(row[0]) / (1024**2) for row in result]  # Convert to MB

            fig, ax = plt.subplots(figsize=(10, 6))
            ax.hist(sizes, bins=50, color='steelblue', edgecolor='black', alpha=0.7)
            ax.set_xlabel('File Size (MB)', fontsize=12)
            ax.set_ylabel('Frequency', fontsize=12)
            ax.set_title('File Size Distribution', fontsize=14, fontweight='bold')
            ax.set_yscale('log')  # Log scale for better visualization
            ax.grid(True, alpha=0.3)

            plt.tight_layout()
            return self._fig_to_base64(fig)
        except Exception as e:
            logger.error(f"Error creating size histogram: {e}")
            return ""

    def _create_age_heatmap(self, age_buckets: List[Dict[str, Any]]) -> str:
        """Create heatmap for file age distribution."""
        if not age_buckets:
            return ""

        try:
            buckets = [item['bucket'] for item in age_buckets]
            file_counts = [item['file_count'] for item in age_buckets]
            sizes_gb = [item['total_size'] / (1024**3) for item in age_buckets]

            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

            # File count heatmap
            file_count_data = [[count] for count in file_counts]
            sns.heatmap(file_count_data, annot=True, fmt='d', cmap='YlOrRd',
                       yticklabels=buckets, xticklabels=['File Count'],
                       cbar_kws={'label': 'Number of Files'}, ax=ax1)
            ax1.set_title('File Count by Age', fontsize=12, fontweight='bold')

            # Size heatmap
            size_data = [[size] for size in sizes_gb]
            sns.heatmap(size_data, annot=True, fmt='.2f', cmap='Blues',
                       yticklabels=buckets, xticklabels=['Size (GB)'],
                       cbar_kws={'label': 'Total Size (GB)'}, ax=ax2)
            ax2.set_title('Storage Size by Age', fontsize=12, fontweight='bold')

            plt.tight_layout()
            return self._fig_to_base64(fig)
        except Exception as e:
            logger.error(f"Error creating age heatmap: {e}")
            return ""

    def _create_subfolder_chart(self, subfolders: List[Dict[str, Any]]) -> str:
        """Create bar chart for largest subfolders."""
        if not subfolders:
            return ""

        try:
            # Take top 10
            top_folders = subfolders[:10]
            # Extract folder names (last component)
            names = [Path(item['path']).name for item in top_folders]
            sizes = [item['total_size'] / (1024**3) for item in top_folders]  # Convert to GB

            fig, ax = plt.subplots(figsize=(10, 6))
            bars = ax.barh(names, sizes, color=sns.color_palette("mako", len(names)))
            ax.set_xlabel('Size (GB)', fontsize=12)
            ax.set_ylabel('Subfolder', fontsize=12)
            ax.set_title('Largest Subfolders by Size', fontsize=14, fontweight='bold')
            ax.invert_yaxis()

            # Add value labels
            for bar, size in zip(bars, sizes):
                width = bar.get_width()
                ax.text(width, bar.get_y() + bar.get_height()/2,
                       f' {size:.2f} GB',
                       ha='left', va='center', fontsize=9)

            plt.tight_layout()
            return self._fig_to_base64(fig)
        except Exception as e:
            logger.error(f"Error creating subfolder chart: {e}")
            return ""

    def _fig_to_base64(self, fig) -> str:
        """Convert matplotlib figure to base64 encoded string."""
        try:
            buffer = io.BytesIO()
            fig.savefig(buffer, format='png', dpi=100, bbox_inches='tight')
            plt.close(fig)
            buffer.seek(0)
            img_base64 = base64.b64encode(buffer.read()).decode('utf-8')
            return f"data:image/png;base64,{img_base64}"
        except Exception as e:
            logger.error(f"Error converting figure to base64: {e}")
            plt.close(fig)
            return ""
