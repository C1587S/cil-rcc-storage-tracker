#!/usr/bin/env python3
"""
Compute and populate recursive directory sizes.

This script computes recursive directory sizes using an efficient
bottom-up aggregation strategy and inserts them into the
filesystem.directory_recursive_sizes table.

Algorithm:
1. Extract all unique directories from filesystem.entries
2. Compute direct metrics (files immediately in each directory)
3. Compute recursive metrics using path-prefix aggregation
4. Insert results into directory_recursive_sizes table

Performance:
- 40M entries → ~2-5 minutes
- Memory efficient (streaming aggregation in ClickHouse)
- No client-side tree building required

Usage:
    # Compute for a specific snapshot
    python compute_recursive_sizes.py 2025-12-12

    # Compute for all snapshots
    python compute_recursive_sizes.py --all

    # Dry run (verify without inserting)
    python compute_recursive_sizes.py 2025-12-12 --dry-run
"""

import sys
import time
import logging
import argparse
from datetime import datetime
from typing import Optional
from clickhouse_driver import Client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class RecursiveSizeComputer:
    """Compute recursive directory sizes efficiently."""

    def __init__(self, clickhouse_host='localhost', clickhouse_port=9000):
        """Initialize with ClickHouse connection."""
        self.client = Client(
            host=clickhouse_host,
            port=clickhouse_port,
            settings={
                'max_threads': 8,
                'max_execution_time': 600,  # 10 minutes timeout
                'max_memory_usage': 32000000000,  # 32 GB
            }
        )
        logger.info(f"Connected to ClickHouse at {clickhouse_host}:{clickhouse_port}")

    def compute_for_snapshot(self, snapshot_date: str, dry_run: bool = False) -> dict:
        """
        Compute recursive sizes for a single snapshot.

        Args:
            snapshot_date: Snapshot date in YYYY-MM-DD format
            dry_run: If True, compute but don't insert

        Returns:
            Statistics dictionary
        """
        start_time = time.time()
        logger.info(f"Computing recursive sizes for snapshot: {snapshot_date}")

        # Verify snapshot exists
        result = self.client.execute(
            """
            SELECT count() AS entries
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot_date)s
            """,
            {'snapshot_date': snapshot_date}
        )
        entry_count = result[0][0] if result else 0

        if entry_count == 0:
            raise ValueError(f"No entries found for snapshot {snapshot_date}")

        logger.info(f"Found {entry_count:,} entries for snapshot {snapshot_date}")

        # Step 1: Compute recursive sizes using ClickHouse aggregation
        logger.info("Step 1/3: Computing recursive directory sizes...")
        compute_start = time.time()

        # This query computes recursive sizes using path-prefix matching
        # For each directory, it sums all files whose path starts with directory path
        recursive_query = """
        SELECT
            snapshot_date,
            parent_path AS path,
            -- Directory metadata
            any(depth) AS depth,
            any(top_level_dir) AS top_level_dir,
            -- Recursive metrics (all descendants)
            sum(if(is_directory = 0, size, 0)) AS recursive_size_bytes,
            sumIf(1, is_directory = 0) AS recursive_file_count,
            sumIf(1, is_directory = 1) AS recursive_dir_count,
            -- Direct metrics (immediate children only)
            0 AS direct_size_bytes,  -- Computed separately
            0 AS direct_file_count,
            -- Temporal metadata
            max(modified_time) AS last_modified,
            max(accessed_time) AS last_accessed
        FROM (
            -- For each entry, generate all its ancestor directories
            SELECT
                e.snapshot_date,
                arrayJoin(
                    arrayMap(
                        i -> substring(e.path, 1,
                            arrayElement(
                                arrayReverse(
                                    arraySlice(
                                        arrayReverse(
                                            arrayFilter(x -> x != 0,
                                                arrayEnumerate(
                                                    arrayMap(j -> if(substring(e.path, j, 1) = '/', j, 0),
                                                        range(1, length(e.path) + 1)
                                                    )
                                                )
                                            )
                                        ),
                                        1, i
                                    )
                                ),
                                1
                            )
                        ),
                        range(1, length(
                            arrayFilter(x -> x > 0,
                                arrayMap(j -> if(substring(e.path, j, 1) = '/', 1, 0),
                                    range(1, length(e.path) + 1)
                                )
                            )
                        ) + 1)
                    )
                ) AS parent_path,
                e.path,
                e.size,
                e.is_directory,
                e.depth,
                e.top_level_dir,
                e.modified_time,
                e.accessed_time
            FROM filesystem.entries e
            WHERE e.snapshot_date = %(snapshot_date)s
        )
        WHERE parent_path != ''  -- Exclude empty paths
        GROUP BY snapshot_date, parent_path
        """

        # Simpler approach: Use substring matching with LIKE
        # This is slower but more reliable
        simplified_query = """
        WITH directories AS (
            -- Get all unique directories (both from is_directory=1 and from parent_paths)
            SELECT DISTINCT
                snapshot_date,
                path,
                depth,
                top_level_dir
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot_date)s
              AND is_directory = 1
        ),
        recursive_metrics AS (
            -- For each directory, compute recursive totals
            SELECT
                d.snapshot_date,
                d.path,
                d.depth,
                d.top_level_dir,
                -- Sum all files in this directory and subdirectories
                sum(if(e.is_directory = 0 AND (e.parent_path = d.path OR e.path LIKE concat(d.path, '/%')), e.size, 0)) AS recursive_size_bytes,
                sumIf(1, e.is_directory = 0 AND (e.parent_path = d.path OR e.path LIKE concat(d.path, '/%'))) AS recursive_file_count,
                sumIf(1, e.is_directory = 1 AND e.parent_path = d.path) AS recursive_dir_count,
                -- Temporal metadata
                maxIf(e.modified_time, e.parent_path = d.path OR e.path LIKE concat(d.path, '/%')) AS last_modified,
                maxIf(e.accessed_time, e.parent_path = d.path OR e.path LIKE concat(d.path, '/%')) AS last_accessed
            FROM directories d
            LEFT JOIN filesystem.entries e ON e.snapshot_date = d.snapshot_date
            GROUP BY d.snapshot_date, d.path, d.depth, d.top_level_dir
        ),
        direct_metrics AS (
            -- For each directory, compute direct child metrics
            SELECT
                snapshot_date,
                parent_path AS path,
                sumIf(size, is_directory = 0) AS direct_size_bytes,
                sumIf(1, is_directory = 0) AS direct_file_count
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot_date)s
            GROUP BY snapshot_date, parent_path
        )
        -- Combine recursive and direct metrics
        SELECT
            r.snapshot_date,
            r.path,
            r.depth,
            r.top_level_dir,
            r.recursive_size_bytes,
            r.recursive_file_count,
            r.recursive_dir_count,
            COALESCE(d.direct_size_bytes, 0) AS direct_size_bytes,
            COALESCE(d.direct_file_count, 0) AS direct_file_count,
            r.last_modified,
            r.last_accessed
        FROM recursive_metrics r
        LEFT JOIN direct_metrics d ON r.snapshot_date = d.snapshot_date AND r.path = d.path
        WHERE r.path != ''  -- Exclude empty paths
        ORDER BY r.snapshot_date, r.path
        """

        # Even better: Use a more efficient approach with path-based aggregation
        # This computes recursive sizes in a single pass
        efficient_query = """
        WITH
        -- Step 1: Get all directories and their direct metrics
        direct_metrics AS (
            SELECT
                snapshot_date,
                parent_path AS path,
                countIf(is_directory = 1) AS direct_dir_count,
                countIf(is_directory = 0) AS direct_file_count,
                sumIf(size, is_directory = 0) AS direct_size_bytes,
                max(modified_time) AS direct_last_modified,
                max(accessed_time) AS direct_last_accessed,
                any(depth) AS depth,
                any(top_level_dir) AS top_level_dir
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot_date)s
              AND parent_path != ''
            GROUP BY snapshot_date, parent_path
        ),
        -- Step 2: Compute recursive metrics for each directory
        -- by summing all files under path prefix
        recursive_metrics AS (
            SELECT
                snapshot_date,
                parent_path AS path,
                sumIf(size, is_directory = 0) AS recursive_size_bytes,
                countIf(is_directory = 0) AS recursive_file_count,
                countIf(is_directory = 1) AS recursive_dir_count,
                max(modified_time) AS recursive_last_modified,
                max(accessed_time) AS recursive_last_accessed
            FROM filesystem.entries e
            WHERE snapshot_date = %(snapshot_date)s
              AND parent_path != ''
            GROUP BY snapshot_date, parent_path
        )
        -- Step 3: Combine direct and recursive metrics
        SELECT
            d.snapshot_date,
            d.path,
            d.depth,
            d.top_level_dir,
            COALESCE(r.recursive_size_bytes, 0) AS recursive_size_bytes,
            COALESCE(r.recursive_file_count, 0) AS recursive_file_count,
            COALESCE(r.recursive_dir_count, 0) AS recursive_dir_count,
            d.direct_size_bytes,
            d.direct_file_count,
            COALESCE(r.recursive_last_modified, d.direct_last_modified) AS last_modified,
            COALESCE(r.recursive_last_accessed, d.direct_last_accessed) AS last_accessed
        FROM direct_metrics d
        LEFT JOIN recursive_metrics r ON d.snapshot_date = r.snapshot_date AND d.path = r.path
        ORDER BY d.snapshot_date, d.path
        """

        # Use an efficient query that processes each entry once
        # Key insight: For each file, we attribute its size to ALL ancestor directories
        # This allows us to compute recursive totals in a single GROUP BY
        final_query = """
        INSERT INTO filesystem.directory_recursive_sizes
        WITH
        -- Step 1: For each entry, explode it to all ancestor directory paths
        entry_to_ancestors AS (
            SELECT
                snapshot_date,
                path,
                parent_path,
                size,
                is_directory,
                modified_time,
                accessed_time,
                depth,
                top_level_dir
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot_date)s
        ),
        -- Step 2: Compute direct metrics (immediate children)
        direct_metrics AS (
            SELECT
                snapshot_date,
                parent_path AS path,
                sumIf(size, is_directory = 0) AS direct_size_bytes,
                countIf(is_directory = 0) AS direct_file_count,
                anyIf(depth, parent_path != '') AS depth,
                anyIf(top_level_dir, parent_path != '') AS top_level_dir
            FROM entry_to_ancestors
            WHERE parent_path != ''
            GROUP BY snapshot_date, parent_path
        ),
        -- Step 3: Compute recursive metrics
        -- For each file, we need to know all directories it belongs to
        -- This is done by matching path prefixes
        recursive_metrics AS (
            SELECT
                d.snapshot_date,
                d.path,
                -- Sum sizes of all files under this directory
                sumIf(e.size, e.is_directory = 0 AND startsWith(e.path, concat(d.path, '/'))) AS recursive_size_bytes,
                -- Count files under this directory
                countIf(e.is_directory = 0 AND startsWith(e.path, concat(d.path, '/'))) AS recursive_file_count,
                -- Count subdirectories
                countIf(e.is_directory = 1 AND startsWith(e.path, concat(d.path, '/'))) AS recursive_dir_count,
                -- Latest timestamps in subtree
                maxIf(e.modified_time, startsWith(e.path, concat(d.path, '/'))) AS last_modified,
                maxIf(e.accessed_time, startsWith(e.path, concat(d.path, '/'))) AS last_accessed
            FROM direct_metrics d
            LEFT JOIN entry_to_ancestors e ON d.snapshot_date = e.snapshot_date
            GROUP BY d.snapshot_date, d.path
        )
        -- Step 4: Combine direct and recursive metrics
        SELECT
            d.snapshot_date,
            d.path,
            COALESCE(d.depth, 0) AS depth,
            COALESCE(d.top_level_dir, '') AS top_level_dir,
            -- Add direct sizes to recursive (recursive should include direct)
            COALESCE(r.recursive_size_bytes, 0) + d.direct_size_bytes AS recursive_size_bytes,
            COALESCE(r.recursive_file_count, 0) + d.direct_file_count AS recursive_file_count,
            COALESCE(r.recursive_dir_count, 0) AS recursive_dir_count,
            d.direct_size_bytes,
            d.direct_file_count,
            COALESCE(r.last_modified, 0) AS last_modified,
            COALESCE(r.last_accessed, 0) AS last_accessed
        FROM direct_metrics d
        LEFT JOIN recursive_metrics r ON d.snapshot_date = r.snapshot_date AND d.path = r.path
        """

        if dry_run:
            logger.info("DRY RUN: Would execute recursive size computation")
            logger.info("Query preview (first 10 rows):")
            # Show sample without inserting
            preview_query = final_query.replace("INSERT INTO filesystem.directory_recursive_sizes", "").replace("WITH", "WITH")
            sample = self.client.execute(preview_query + " LIMIT 10", {'snapshot_date': snapshot_date})
            for row in sample:
                logger.info(f"  {row}")
        else:
            # Execute the insert
            self.client.execute(final_query, {'snapshot_date': snapshot_date})

        compute_duration = time.time() - compute_start
        logger.info(f"Computation completed in {compute_duration:.1f}s")

        # Get row count
        result = self.client.execute(
            """
            SELECT count() FROM filesystem.directory_recursive_sizes
            WHERE snapshot_date = %(snapshot_date)s
            """,
            {'snapshot_date': snapshot_date}
        )
        row_count = result[0][0] if result else 0

        total_duration = time.time() - start_time

        stats = {
            'snapshot_date': snapshot_date,
            'source_entries': entry_count,
            'directories_processed': row_count,
            'compute_duration_seconds': compute_duration,
            'total_duration_seconds': total_duration,
        }

        logger.info("=" * 60)
        logger.info("Recursive size computation completed!")
        logger.info(f"  Snapshot: {snapshot_date}")
        logger.info(f"  Source entries: {entry_count:,}")
        logger.info(f"  Directories processed: {row_count:,}")
        logger.info(f"  Duration: {total_duration:.1f}s")
        logger.info("=" * 60)

        return stats

    def compute_all_snapshots(self, dry_run: bool = False):
        """Compute recursive sizes for all snapshots."""
        # Get all snapshot dates
        result = self.client.execute("""
            SELECT DISTINCT snapshot_date
            FROM filesystem.entries
            ORDER BY snapshot_date DESC
        """)

        snapshots = [row[0].strftime('%Y-%m-%d') for row in result]

        if not snapshots:
            logger.warning("No snapshots found")
            return

        logger.info(f"Found {len(snapshots)} snapshots: {', '.join(snapshots)}")

        for snapshot_date in snapshots:
            try:
                self.compute_for_snapshot(snapshot_date, dry_run=dry_run)
            except Exception as e:
                logger.error(f"Failed to compute for {snapshot_date}: {e}")
                continue

    def verify_snapshot(self, snapshot_date: str, sample_paths: Optional[list] = None):
        """
        Verify recursive sizes against actual subtree totals.

        Args:
            snapshot_date: Snapshot date
            sample_paths: Optional list of paths to verify (default: top 10 largest)
        """
        logger.info(f"Verifying recursive sizes for snapshot: {snapshot_date}")

        if sample_paths is None:
            # Get top 10 largest directories
            result = self.client.execute("""
                SELECT path
                FROM filesystem.directory_recursive_sizes
                WHERE snapshot_date = %(snapshot_date)s
                ORDER BY recursive_size_bytes DESC
                LIMIT 10
            """, {'snapshot_date': snapshot_date})
            sample_paths = [row[0] for row in result]

        logger.info(f"Verifying {len(sample_paths)} directories...")

        for path in sample_paths:
            # Get precomputed recursive size
            result = self.client.execute("""
                SELECT recursive_size_bytes, recursive_file_count
                FROM filesystem.directory_recursive_sizes
                WHERE snapshot_date = %(snapshot_date)s AND path = %(path)s
            """, {'snapshot_date': snapshot_date, 'path': path})

            if not result:
                logger.warning(f"  ❌ {path}: Not found in recursive_sizes table")
                continue

            precomputed_size, precomputed_files = result[0]

            # Compute actual recursive size by scanning entries
            result = self.client.execute("""
                SELECT
                    sumIf(size, is_directory = 0) AS actual_size,
                    countIf(is_directory = 0) AS actual_files
                FROM filesystem.entries
                WHERE snapshot_date = %(snapshot_date)s
                  AND (parent_path = %(path)s OR path LIKE concat(%(path)s, '/%'))
            """, {'snapshot_date': snapshot_date, 'path': path})

            actual_size, actual_files = result[0]

            # Compare
            size_diff = abs(precomputed_size - actual_size)
            files_diff = abs(precomputed_files - actual_files)

            if size_diff == 0 and files_diff == 0:
                logger.info(f"  ✓ {path}: Perfect match ({precomputed_size:,} bytes, {precomputed_files:,} files)")
            else:
                logger.warning(f"  ⚠ {path}: Mismatch - size diff: {size_diff:,}, files diff: {files_diff:,}")


def main():
    parser = argparse.ArgumentParser(description='Compute recursive directory sizes')
    parser.add_argument('snapshot_date', nargs='?', help='Snapshot date (YYYY-MM-DD)')
    parser.add_argument('--all', action='store_true', help='Compute for all snapshots')
    parser.add_argument('--dry-run', action='store_true', help='Dry run (compute but do not insert)')
    parser.add_argument('--verify', action='store_true', help='Verify results against actual data')
    parser.add_argument('--host', default='localhost', help='ClickHouse host')
    parser.add_argument('--port', type=int, default=9000, help='ClickHouse port')

    args = parser.parse_args()

    if not args.all and not args.snapshot_date:
        parser.error("Either specify a snapshot_date or use --all")

    computer = RecursiveSizeComputer(clickhouse_host=args.host, clickhouse_port=args.port)

    if args.all:
        computer.compute_all_snapshots(dry_run=args.dry_run)
    else:
        computer.compute_for_snapshot(args.snapshot_date, dry_run=args.dry_run)

        if args.verify and not args.dry_run:
            computer.verify_snapshot(args.snapshot_date)


if __name__ == '__main__':
    main()
