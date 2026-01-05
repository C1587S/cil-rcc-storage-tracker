#!/usr/bin/env python3
"""
Import filesystem snapshot from Parquet files into ClickHouse.
Optimized for LOW MEMORY usage via streaming, with automatic structure preservation.
"""

import sys
import time
import logging
import gc
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

import polars as pl
import pyarrow.parquet as pq
from clickhouse_driver import Client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class SnapshotImporter:
    """Import Parquet snapshot into ClickHouse using streaming + in-db fixups."""

    def __init__(self, clickhouse_host=None, clickhouse_port=None):
        import os
        if clickhouse_host is None:
            clickhouse_host = os.getenv('CLICKHOUSE_HOST', 'localhost')
        if clickhouse_port is None:
            clickhouse_port = int(os.getenv('CLICKHOUSE_PORT', '9000'))

        self.client = Client(
            host=clickhouse_host,
            port=clickhouse_port,
            settings={
                'compression': 'lz4',
                'max_insert_block_size': 1_000_000,
                'send_timeout': 300,
                'receive_timeout': 300,
            }
        )
        logger.info(f"Connected to ClickHouse at {clickhouse_host}:{clickhouse_port}")

    def import_snapshot(self, snapshot_dir: Path, clear_existing: bool = True) -> Dict[str, Any]:
        start_time = time.time()
        snapshot_date = snapshot_dir.name
        
        logger.info(f"Importing snapshot: {snapshot_date}")
        logger.info(f"Source directory: {snapshot_dir}")

        # 1. Clear Old Data
        if clear_existing:
            self._clear_existing_data(snapshot_date)

        parquet_files = list(snapshot_dir.glob("*.parquet"))
        if not parquet_files:
            raise ValueError(f"No Parquet files found in {snapshot_dir}")

        # 2. Stream Data (Low Memory Phase)
        total_rows = 0
        total_size = 0

        for parquet_file in parquet_files:
            logger.info(f"Processing {parquet_file.name}...")
            file_start = time.time()
            
            rows, size = self._import_parquet_file_stream(parquet_file, snapshot_date)

            total_rows += rows
            total_size += size
            
            duration = time.time() - file_start
            logger.info(
                f"  Finished {parquet_file.name}: {rows:,} rows "
                f"in {duration:.1f}s"
            )
            gc.collect() # Force cleanup

        # 3. Fix Directory Flags (Structure Preservation Phase)
        # This replaces the logic that used to run in Python memory
        self._finalize_directory_flags(snapshot_date)

        # 4. Update Metadata (Now that flags are correct)
        self._update_snapshot_metadata(snapshot_date)

        total_duration = time.time() - start_time
        throughput = total_rows / total_duration if total_duration > 0 else 0

        stats = {
            'snapshot_date': snapshot_date,
            'total_rows': total_rows,
            'total_size_mb': total_size / 1024 / 1024,
            'total_duration_seconds': total_duration,
            'rows_per_second': throughput,
        }

        self._log_summary(stats)
        return stats

    def _import_parquet_file_stream(self, parquet_file: Path, snapshot_date: str) -> tuple[int, int]:
        """Stream Parquet file in chunks."""
        file_size = parquet_file.stat().st_size
        total_rows_imported = 0
        BATCH_SIZE = 500_000 

        try:
            pq_file = pq.ParquetFile(parquet_file)
        except Exception as e:
            logger.error(f"Failed to open {parquet_file}: {e}")
            return 0, 0

        num_batches = (pq_file.metadata.num_rows + BATCH_SIZE - 1) // BATCH_SIZE
        batch_idx = 0

        for batch in pq_file.iter_batches(batch_size=BATCH_SIZE):
            batch_idx += 1
            
            # Convert to Polars for fast transform
            df = pl.from_arrow(batch)
            
            # Transform
            df = self._transform_batch(df, snapshot_date)
            
            # Insert
            self._insert_batch(df)

            total_rows_imported += len(df)
            
            if batch_idx % 10 == 0:
                logger.debug(f"    Batch {batch_idx}/{num_batches}...")

            del df # Free memory

        return total_rows_imported, file_size

    def _transform_batch(self, df: pl.DataFrame, snapshot_date: str) -> pl.DataFrame:
        """Prepare batch for ClickHouse."""
        snapshot_date_obj = datetime.strptime(snapshot_date, '%Y-%m-%d').date()

        # Basic extractions
        df = df.with_columns([
            pl.col('path').str.split('/').list.last().alias('name'),
            pl.lit(snapshot_date_obj).alias('snapshot_date')
        ])

        # Handle 'is_directory':
        # If 'file_type' exists, use it. If not, default to 0.
        # The database fixup step later will correct any mistakes here.
        if 'file_type' in df.columns:
            df = df.with_columns([
                (pl.col('file_type') == 'directory').cast(pl.UInt8).alias('is_directory')
            ])
        else:
            df = df.with_columns([pl.lit(0).cast(pl.UInt8).alias('is_directory')])

        # Handle Group/GroupName rename
        if 'group' in df.columns and 'group_name' not in df.columns:
            df = df.rename({'group': 'group_name'})

        # Fill Defaults efficiently
        defaults = {
            'owner': 'unknown', 'group_name': 'unknown', 'file_type': 'unknown',
            'uid': 0, 'gid': 0, 
            'modified_time': 0, 'accessed_time': 0, 'created_time': 0
        }
        
        # Create missing columns
        new_cols = []
        for col, val in defaults.items():
            if col not in df.columns:
                dtype = pl.UInt32 if isinstance(val, int) else pl.Utf8
                new_cols.append(pl.lit(val).cast(dtype).alias(col))
        if new_cols:
            df = df.with_columns(new_cols)

        # Handle Nulls in existing columns
        df = df.with_columns([
            pl.col('owner').fill_null('unknown'),
            pl.col('group_name').fill_null('unknown'),
            pl.col('file_type').fill_null('unknown'),
        ])
        
        # Cast Times
        for time_col in ['modified_time', 'accessed_time', 'created_time']:
            df = df.with_columns([pl.col(time_col).fill_null(0).cast(pl.UInt32)])

        return df

    def _insert_batch(self, df: pl.DataFrame):
        """Insert batch."""
        columns_order = [
            'snapshot_date', 'path', 'parent_path', 'name', 'depth',
            'top_level_dir', 'size', 'file_type', 'is_directory',
            'modified_time', 'accessed_time', 'created_time',
            'inode', 'permissions', 'owner', 'group_name', 'uid', 'gid'
        ]
        
        # Only select columns that actually exist in dataframe
        available_columns = [col for col in columns_order if col in df.columns]
        df = df.select(available_columns)
        
        query = f"INSERT INTO filesystem.entries ({', '.join(available_columns)}) VALUES"
        self.client.execute(query, df.rows())

    def _finalize_directory_flags(self, snapshot_date: str):
        """
        CRITICAL: This ensures 'is_directory' is correct without using Python RAM.
        It runs a SQL query to mark any path that appears as a 'parent_path' as a directory.
        """
        logger.info("Finalizing directory structure (Calculating is_directory flags)...")
        
        # 1. Trigger the update
        query = f"""
            ALTER TABLE filesystem.entries
            UPDATE is_directory = 1
            WHERE snapshot_date = '{snapshot_date}'
              AND path IN (
                SELECT DISTINCT parent_path
                FROM filesystem.entries
                WHERE snapshot_date = '{snapshot_date}'
            )
        """
        self.client.execute(query)

        # 2. Wait for the update to complete
        # ClickHouse mutations are async. We must wait or stats will be wrong.
        logger.info("Waiting for database to apply structure updates...")
        while True:
            # Check if there are active mutations for this table
            pending = self.client.execute("""
                SELECT count()
                FROM system.mutations
                WHERE database = 'filesystem' 
                  AND table = 'entries' 
                  AND is_done = 0
            """)[0][0]
            
            if pending == 0:
                break
            time.sleep(2)
        
        logger.info("Directory structure finalized.")

    def _update_snapshot_metadata(self, snapshot_date: str):
        """Calculate and insert snapshot metadata."""
        logger.info("Updating snapshot metadata...")
        
        # We calculate stats AFTER the finalize step, so 'total_directories' is correct
        stats = self.client.execute(f"""
            SELECT
                count() as total_entries,
                sum(size) as total_size,
                sumIf(1, is_directory = 1) as total_directories,
                sumIf(1, is_directory = 0) as total_files,
                groupArray(DISTINCT top_level_dir) as top_level_dirs
            FROM filesystem.entries
            WHERE snapshot_date = '{snapshot_date}'
        """)[0]

        total_entries, total_size, total_directories, total_files, top_level_dirs = stats
        
        self.client.execute(
            "ALTER TABLE filesystem.snapshots DELETE WHERE snapshot_date = %(date)s",
            {'date': snapshot_date}
        )

        self.client.execute("""
            INSERT INTO filesystem.snapshots
            (snapshot_date, scan_started, scan_completed, total_entries, total_size,
             total_directories, total_files, top_level_dirs, scanner_version, import_duration_seconds)
            VALUES
        """, [(
            datetime.strptime(snapshot_date, '%Y-%m-%d').date(),
            datetime.now(), datetime.now(),
            total_entries, total_size, total_directories, total_files, top_level_dirs,
            'unknown', 0.0,
        )])

    def _clear_existing_data(self, snapshot_date: str):
        logger.info(f"Clearing existing data for {snapshot_date}...")
        try:
            self.client.execute(
                "ALTER TABLE filesystem.entries DELETE WHERE snapshot_date = %(date)s",
                {'date': snapshot_date}
            )
        except Exception:
            pass

    def _log_summary(self, stats):
        logger.info("=" * 60)
        logger.info(f"Import completed successfully!")
        logger.info(f"  Total rows: {stats['total_rows']:,}")
        logger.info(f"  Total size: {stats['total_size_mb']:.1f} MB")
        logger.info("=" * 60)

    def verify_import(self, snapshot_date: str) -> bool:
        count = self.client.execute(f"SELECT count() FROM filesystem.entries WHERE snapshot_date = '{snapshot_date}'")[0][0]
        return count > 0

    def close(self):
        self.client.disconnect()

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot_dir')
    parser.add_argument('--no-clear', action='store_true')
    args = parser.parse_args()

    snapshot_dir = Path(args.snapshot_dir)
    importer = SnapshotImporter()
    
    try:
        importer.import_snapshot(snapshot_dir, clear_existing=not args.no_clear)
        if importer.verify_import(snapshot_dir.name):
            sys.exit(0)
        sys.exit(1)
    except Exception as e:
        logger.error(f"Import failed: {e}", exc_info=True)
        sys.exit(1)
    finally:
        importer.close()

if __name__ == "__main__":
    main()