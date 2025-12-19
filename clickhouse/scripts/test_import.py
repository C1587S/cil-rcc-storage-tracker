#!/usr/bin/env python3
"""
Quick test of ClickHouse setup using a sample from the actual data.

This script:
1. Connects to ClickHouse
2. Tests import with first 100K rows from sample Parquet file
3. Verifies materialized views work
4. Runs sample queries
"""

import sys
import time
import logging
from pathlib import Path
import polars as pl
from clickhouse_driver import Client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_clickhouse():
    """Run ClickHouse test with sample data."""
    logger.info("Testing ClickHouse setup...")

    # Connect
    client = Client(host='localhost', port=9000, database='filesystem')

    # Find sample data
    sample_dir = Path("/home/scs/Git/tracker-app/cil_scans_aggregated/2025-12-12")
    if not sample_dir.exists():
        logger.error(f"Sample data not found at {sample_dir}")
        return False

    # Get first Parquet file
    parquet_files = list(sample_dir.glob("*.parquet"))
    if not parquet_files:
        logger.error(f"No Parquet files in {sample_dir}")
        return False

    sample_file = parquet_files[0]
    logger.info(f"Using sample file: {sample_file.name}")

    # Read first 100K rows
    logger.info("Reading 100K rows from Parquet...")
    df = pl.read_parquet(sample_file).head(100000)

    logger.info(f"  Loaded {len(df):,} rows")
    logger.info(f"  Columns: {df.columns}")

    # Transform data
    logger.info("Transforming data...")

    # Add required columns
    from datetime import date as dt_date
    df = df.with_columns([
        pl.col('path').str.split('/').list.last().alias('name'),
        pl.lit(dt_date(2025, 12, 12)).alias('snapshot_date'),
    ])

    # Determine directories
    all_parents = set(df['parent_path'].unique().to_list())
    df = df.with_columns([
        pl.col('path').is_in(all_parents).cast(pl.UInt8).alias('is_directory')
    ])

    # Rename 'group' to 'group_name' if it exists
    if 'group' in df.columns and 'group_name' not in df.columns:
        df = df.rename({'group': 'group_name'})

    # Fill null values in string columns with empty string or defaults
    df = df.with_columns([
        pl.col('owner').fill_null('unknown'),
        pl.col('group_name').fill_null('unknown'),
        pl.col('file_type').fill_null('unknown'),
    ])

    # Handle missing columns
    for col, default in [
        ('owner', 'unknown'),
        ('group_name', 'unknown'),
        ('uid', 0),
        ('gid', 0),
    ]:
        if col not in df.columns:
            df = df.with_columns([pl.lit(default).alias(col)])

    # Convert timestamps to UInt32 (handle nulls by replacing with 0)
    for time_col in ['modified_time', 'accessed_time', 'created_time']:
        df = df.with_columns([
            pl.col(time_col).fill_null(0).cast(pl.UInt32)
        ])

    # Select columns
    columns = [
        'snapshot_date', 'path', 'parent_path', 'name', 'depth', 'top_level_dir',
        'size', 'file_type', 'is_directory', 'modified_time', 'accessed_time',
        'created_time', 'inode', 'permissions', 'owner', 'group_name', 'uid', 'gid',
    ]

    available_columns = [col for col in columns if col in df.columns]
    df = df.select(available_columns)

    # Convert to tuples
    data = df.rows()

    # Insert
    logger.info(f"Inserting {len(data):,} rows...")
    start = time.time()

    client.execute(
        f"INSERT INTO filesystem.entries ({', '.join(available_columns)}) VALUES",
        data
    )

    duration = time.time() - start
    logger.info(f"  Inserted in {duration:.2f}s ({len(data)/duration:.0f} rows/s)")

    # Verify materialized views
    logger.info("Verifying materialized views...")

    views = [
        'directory_hierarchy',
        'directory_sizes',
        'file_type_distribution',
        'owner_distribution',
    ]

    for view in views:
        count = client.execute(f"SELECT count() FROM filesystem.{view}")[0][0]
        logger.info(f"  {view}: {count:,} rows")

    # Test queries
    logger.info("Testing queries...")

    # Query 1: Get top-level directories
    query1_start = time.time()
    result1 = client.execute("""
        SELECT DISTINCT parent_path
        FROM filesystem.entries
        WHERE depth = 1
        LIMIT 10
    """)
    query1_time = (time.time() - query1_start) * 1000
    logger.info(f"  Query 1 (top dirs): {len(result1)} results in {query1_time:.1f}ms")

    if result1:
        # Query 2: Get children of first top directory
        top_dir = result1[0][0]
        query2_start = time.time()
        result2 = client.execute(f"""
            SELECT child_path, total_size, is_directory
            FROM filesystem.directory_hierarchy
            WHERE parent_path = '{top_dir}'
            ORDER BY total_size DESC
            LIMIT 10
        """)
        query2_time = (time.time() - query2_start) * 1000
        logger.info(f"  Query 2 (children): {len(result2)} results in {query2_time:.1f}ms")

    # Query 3: Heavy files
    query3_start = time.time()
    result3 = client.execute("""
        SELECT path, size
        FROM filesystem.entries
        WHERE is_directory = 0
        ORDER BY size DESC
        LIMIT 10
    """)
    query3_time = (time.time() - query3_start) * 1000
    logger.info(f"  Query 3 (heavy files): {len(result3)} results in {query3_time:.1f}ms")

    # Query 4: File type distribution
    query4_start = time.time()
    result4 = client.execute("""
        SELECT file_type, sum(total_size) as size
        FROM filesystem.file_type_distribution
        GROUP BY file_type
        ORDER BY size DESC
        LIMIT 10
    """)
    query4_time = (time.time() - query4_start) * 1000
    logger.info(f"  Query 4 (file types): {len(result4)} results in {query4_time:.1f}ms")

    logger.info("=" * 60)
    logger.info("Test completed successfully!")
    logger.info(f"All queries completed in < {max(query1_time, query2_time, query3_time, query4_time):.0f}ms")
    logger.info("=" * 60)

    client.disconnect()
    return True


if __name__ == "__main__":
    try:
        success = test_clickhouse()
        sys.exit(0 if success else 1)
    except Exception as e:
        logger.error(f"Test failed: {e}", exc_info=True)
        sys.exit(1)
