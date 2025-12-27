#!/usr/bin/env python3
"""
Compute and populate recursive directory sizes (ClickHouse-scalable v3).

Key idea (O(n)):
- For each FILE path, generate all ancestor directories via arrayJoin(prefixes)
  and add its size to each ancestor (recursive rollup).
- For each DIRECTORY path, generate its ancestor directories (excluding itself)
  and count it towards recursive_dir_count of each ancestor.
- For direct metrics, aggregate files by parent_path.

This avoids CROSS JOIN / cartesian products and works on tens of millions of rows.

Usage:
    source ./venv/bin/activate
    python scripts/compute_recursive_sizes_v3.py 2025-12-12
    python scripts/compute_recursive_sizes_v3.py 2025-12-12 --verify --verify-samples 10
    python scripts/compute_recursive_sizes_v3.py --all

Expected runtime on ~40M entries: minutes (depends on IO/CPU).
"""

import sys
import time
import logging
import argparse
from datetime import datetime
from clickhouse_driver import Client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class RecursiveSizeComputerV3:
    def __init__(self, host: str = "localhost", port: int = 9000, database: str = "filesystem"):
        self.host = host
        self.port = port
        self.database = database

        # Tweak settings to be safe; ClickHouse will still enforce server limits
        self.client = Client(
            host=host,
            port=port,
            database=database,
            settings={
                "max_threads": 8,
                "max_execution_time": 1800,      # 30 min (for full snapshot)
                "max_memory_usage": 0,           # 0 = server default; do not override aggressively here
                "join_use_nulls": 1,
            },
        )
        logger.info(f"Connected to ClickHouse at {host}:{port}, db={database}")

    def snapshot_exists(self, snapshot_date: str) -> int:
        rows = self.client.execute(
            "SELECT count() FROM filesystem.entries WHERE snapshot_date = %(snapshot_date)s",
            {"snapshot_date": snapshot_date},
        )
        return int(rows[0][0])

    def clear_snapshot(self, snapshot_date: str) -> None:
        logger.info("Clearing existing rows for snapshot in directory_recursive_sizes...")
        self.client.execute(
            "ALTER TABLE filesystem.directory_recursive_sizes DELETE WHERE snapshot_date = %(snapshot_date)s",
            {"snapshot_date": snapshot_date},
        )

    def compute_for_snapshot(self, snapshot_date: str) -> dict:
        start = time.time()
        logger.info(f"Computing recursive directory sizes for snapshot: {snapshot_date}")

        entry_count = self.snapshot_exists(snapshot_date)
        if entry_count == 0:
            raise ValueError(f"No entries found for snapshot {snapshot_date}")

        logger.info(f"  Source entries: {entry_count:,}")

        self.clear_snapshot(snapshot_date)

        logger.info("Running INSERT…SELECT rollup (this may take a few minutes)...")
        compute_start = time.time()

        # IMPORTANT: no '%' literals in SQL; clickhouse_driver uses % for parameter substitution.
        # This query:
        # - recursive rollup from FILES
        # - recursive dir count rollup from DIRECTORIES
        # - direct metrics from FILES grouped by parent_path
        # - union of all directories seen in either rollup
        query = """
        INSERT INTO filesystem.directory_recursive_sizes
        SELECT
            snapshot_date,
            path,
            depth,
            top_level_dir,
            recursive_size_bytes,
            recursive_file_count,
            recursive_dir_count,
            direct_size_bytes,
            direct_file_count,
            last_modified,
            last_accessed
        FROM
        (
            SELECT
                toDate(%(snapshot_date)s) AS snapshot_date,
                path,

                toUInt16(length(arrayFilter(x -> x != '', splitByChar('/', path)))) AS depth,

                if(
                    length(arrayFilter(x -> x != '', splitByChar('/', path))) >= 1,
                    arrayElement(arrayFilter(x -> x != '', splitByChar('/', path)), 1),
                    ''
                ) AS top_level_dir,

                sum(recursive_size_bytes) AS recursive_size_bytes,
                sum(recursive_file_count) AS recursive_file_count,
                sum(recursive_dir_count) AS recursive_dir_count,
                sum(direct_size_bytes) AS direct_size_bytes,
                sum(direct_file_count) AS direct_file_count,
                max(last_modified) AS last_modified,
                max(last_accessed) AS last_accessed
            FROM
            (
                -- ------------------------------------------------------------
                -- FILE rollup: files contribute to all ancestor directories
                -- ------------------------------------------------------------
                SELECT
                    dir_path AS path,
                    size AS recursive_size_bytes,
                    1 AS recursive_file_count,
                    0 AS recursive_dir_count,
                    0 AS direct_size_bytes,
                    0 AS direct_file_count,
                    modified_time AS last_modified,
                    accessed_time AS last_accessed
                FROM
                (
                    SELECT
                        size,
                        modified_time,
                        accessed_time,
                        arrayJoin(
                            arrayMap(
                                i -> concat('/', arrayStringConcat(arraySlice(parts, 1, i), '/')),
                                range(1, length(parts))
                            )
                        ) AS dir_path
                    FROM
                    (
                        SELECT
                            size,
                            modified_time,
                            accessed_time,
                            arrayFilter(x -> x != '', splitByChar('/', path)) AS parts
                        FROM filesystem.entries
                        WHERE snapshot_date = toDate(%(snapshot_date)s)
                        AND is_directory = 0
                    )
                    WHERE length(parts) >= 2
                )

                UNION ALL

                -- ------------------------------------------------------------
                -- DIRECTORY rollup: directories count toward ancestors
                -- ------------------------------------------------------------
                SELECT
                    dir_path AS path,
                    0 AS recursive_size_bytes,
                    0 AS recursive_file_count,
                    1 AS recursive_dir_count,
                    0 AS direct_size_bytes,
                    0 AS direct_file_count,
                    0 AS last_modified,
                    0 AS last_accessed
                FROM
                (
                    SELECT
                        arrayJoin(
                            arrayMap(
                                i -> concat('/', arrayStringConcat(arraySlice(parts, 1, i), '/')),
                                range(1, length(parts))
                            )
                        ) AS dir_path
                    FROM
                    (
                        SELECT
                            arrayFilter(x -> x != '', splitByChar('/', path)) AS parts
                        FROM filesystem.entries
                        WHERE snapshot_date = toDate(%(snapshot_date)s)
                        AND is_directory = 1
                    )
                    WHERE length(parts) >= 2
                )

                UNION ALL

                -- ------------------------------------------------------------
                -- DIRECT files
                -- ------------------------------------------------------------
                SELECT
                    parent_path AS path,
                    0 AS recursive_size_bytes,
                    0 AS recursive_file_count,
                    0 AS recursive_dir_count,
                    size AS direct_size_bytes,
                    1 AS direct_file_count,
                    modified_time AS last_modified,
                    accessed_time AS last_accessed
                FROM filesystem.entries
                WHERE snapshot_date = toDate(%(snapshot_date)s)
                AND is_directory = 0
                AND parent_path != ''
            )
            GROUP BY path
        )
        """


        # Execute with parameter binding
        self.client.execute(query, {"snapshot_date": snapshot_date})

        compute_secs = time.time() - compute_start

        # Count output rows
        out_rows = self.client.execute(
            "SELECT count() FROM filesystem.directory_recursive_sizes WHERE snapshot_date = toDate(%(snapshot_date)s)",
            {"snapshot_date": snapshot_date},
        )[0][0]

        total_secs = time.time() - start
        logger.info("=" * 70)
        logger.info("✓ Completed recursive directory size materialization")
        logger.info(f"  Snapshot:         {snapshot_date}")
        logger.info(f"  Source entries:   {entry_count:,}")
        logger.info(f"  Output dirs:      {out_rows:,}")
        logger.info(f"  Compute time:     {compute_secs:.1f}s")
        logger.info(f"  Total time:       {total_secs:.1f}s")
        logger.info("=" * 70)

        return {
            "snapshot_date": snapshot_date,
            "entries": entry_count,
            "directories_rows": int(out_rows),
            "duration_seconds": float(total_secs),
        }

    def verify_snapshot(self, snapshot_date: str, num_samples: int = 10) -> None:
        """
        Verify by sampling large directories and comparing precomputed recursive_size_bytes
        against an on-the-fly subtree sum (slow but OK for a few samples).

        Note: This check compares recursive_size_bytes to sum(size) of files in subtree.
        """
        logger.info(f"Verifying snapshot {snapshot_date} with {num_samples} samples...")

        samples = self.client.execute(
            """
            SELECT path, recursive_size_bytes, recursive_file_count
            FROM filesystem.directory_recursive_sizes
            WHERE snapshot_date = toDate(%(snapshot_date)s)
            ORDER BY recursive_size_bytes DESC
            LIMIT %(n)s
            """,
            {"snapshot_date": snapshot_date, "n": num_samples},
        )

        if not samples:
            logger.error("No rows found in directory_recursive_sizes for this snapshot.")
            return

        errors = 0
        for path, pre_size, pre_files in samples:
            actual = self.client.execute(
                """
                SELECT
                    sumIf(size, is_directory = 0) AS size,
                    countIf(is_directory = 0) AS files
                FROM filesystem.entries
                WHERE snapshot_date = toDate(%(snapshot_date)s)
                  AND is_directory = 0
                  AND startsWith(path, concat(%(dir)s, '/'))
                """,
                {"snapshot_date": snapshot_date, "dir": path},
            )[0]
            act_size, act_files = actual

            # NOTE: startsWith(path, dir + '/') excludes files directly in dir.
            # Add direct files:
            direct = self.client.execute(
                """
                SELECT
                    sum(size) AS size,
                    count() AS files
                FROM filesystem.entries
                WHERE snapshot_date = toDate(%(snapshot_date)s)
                  AND is_directory = 0
                  AND parent_path = %(dir)s
                """,
                {"snapshot_date": snapshot_date, "dir": path},
            )[0]
            dir_size, dir_files = direct

            act_size_total = (act_size or 0) + (dir_size or 0)
            act_files_total = (act_files or 0) + (dir_files or 0)

            if int(pre_size) == int(act_size_total) and int(pre_files) == int(act_files_total):
                logger.info(f"✓ {path}  size={pre_size:,} files={pre_files:,}")
            else:
                errors += 1
                logger.error(f"✗ {path}")
                logger.error(f"    pre:  size={pre_size:,} files={pre_files:,}")
                logger.error(f"    act:  size={act_size_total:,} files={act_files_total:,}")
                logger.error(f"    diff: size={int(pre_size) - int(act_size_total):,} files={int(pre_files) - int(act_files_total):,}")

        if errors == 0:
            logger.info("✓ Verification passed (all samples match).")
        else:
            logger.error(f"✗ Verification failed: {errors}/{len(samples)} mismatches.")

    def compute_all_snapshots(self) -> None:
        snaps = self.client.execute(
            """
            SELECT DISTINCT snapshot_date
            FROM filesystem.entries
            ORDER BY snapshot_date DESC
            """
        )
        dates = [row[0].strftime("%Y-%m-%d") for row in snaps]
        if not dates:
            logger.warning("No snapshots found.")
            return

        logger.info(f"Found {len(dates)} snapshots.")
        for d in dates:
            try:
                self.compute_for_snapshot(d)
            except Exception as e:
                logger.error(f"Failed snapshot {d}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Compute recursive directory sizes (ClickHouse v3)")
    parser.add_argument("snapshot_date", nargs="?", help="Snapshot date YYYY-MM-DD")
    parser.add_argument("--all", action="store_true", help="Process all snapshots")
    parser.add_argument("--verify", action="store_true", help="Verify results with samples")
    parser.add_argument("--verify-samples", type=int, default=10, help="How many directories to verify")
    parser.add_argument("--host", default="localhost", help="ClickHouse host")
    parser.add_argument("--port", type=int, default=9000, help="ClickHouse port")
    parser.add_argument("--db", default="filesystem", help="ClickHouse database")

    args = parser.parse_args()

    if not args.all and not args.snapshot_date:
        parser.error("Provide snapshot_date or use --all")

    comp = RecursiveSizeComputerV3(host=args.host, port=args.port, database=args.db)

    try:
        if args.all:
            comp.compute_all_snapshots()
        else:
            comp.compute_for_snapshot(args.snapshot_date)
            if args.verify:
                comp.verify_snapshot(args.snapshot_date, args.verify_samples)
    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
