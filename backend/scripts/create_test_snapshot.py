#!/usr/bin/env python3
"""
Create Test Snapshot

Creates a small test snapshot from a larger snapshot by sampling data.
Useful for quick testing without loading all data.

Usage:
    # Sample 10,000 rows from each parquet file
    python scripts/create_test_snapshot.py 2025-12-12 2025-12-12-test --rows 10000

    # Sample 1% of data
    python scripts/create_test_snapshot.py 2025-12-12 2025-12-12-test --sample 0.01

    # Use only one parquet file
    python scripts/create_test_snapshot.py 2025-12-12 2025-12-12-test --file beagle.parquet
"""

import sys
import argparse
from pathlib import Path
import pyarrow.parquet as pq
import pyarrow as pa

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings


def create_test_snapshot(
    source_date: str,
    dest_date: str,
    max_rows: int = None,
    sample_fraction: float = None,
    specific_file: str = None
):
    """
    Create a test snapshot from a larger snapshot.

    Args:
        source_date: Source snapshot date
        dest_date: Destination snapshot date (for test data)
        max_rows: Maximum rows per file
        sample_fraction: Fraction of rows to sample (0.0 to 1.0)
        specific_file: Use only this specific file
    """
    settings = get_settings()
    snapshots_path = settings.get_absolute_snapshots_path()

    source_dir = snapshots_path / source_date
    dest_dir = snapshots_path / dest_date

    print(f"{'='*70}")
    print(f"CREATE TEST SNAPSHOT")
    print(f"{'='*70}")
    print(f"Source:      {source_dir}")
    print(f"Destination: {dest_dir}")
    print(f"Max rows:    {max_rows or 'unlimited'}")
    print(f"Sample:      {sample_fraction or 'none'}")
    print(f"File:        {specific_file or 'all'}")
    print(f"{'='*70}\n")

    # Validate source
    if not source_dir.exists():
        print(f"ERROR: Source snapshot not found: {source_dir}")
        sys.exit(1)

    # Find parquet files
    if specific_file:
        parquet_files = [source_dir / specific_file]
        if not parquet_files[0].exists():
            print(f"ERROR: File not found: {specific_file}")
            sys.exit(1)
    else:
        parquet_files = list(source_dir.glob("*.parquet"))

    if not parquet_files:
        print(f"ERROR: No parquet files found in {source_dir}")
        sys.exit(1)

    print(f"Found {len(parquet_files)} parquet file(s):\n")

    # Create destination directory
    dest_dir.mkdir(parents=True, exist_ok=True)

    total_source_rows = 0
    total_dest_rows = 0

    # Process each file
    for i, source_file in enumerate(sorted(parquet_files), 1):
        print(f"[{i}/{len(parquet_files)}] Processing {source_file.name}...")

        # Read source
        table = pq.read_table(source_file)
        source_rows = len(table)
        total_source_rows += source_rows

        print(f"  Source: {source_rows:,} rows")

        # Determine how many rows to keep
        if max_rows and source_rows > max_rows:
            # Take first N rows
            sampled_table = table.slice(0, max_rows)
            print(f"  Sampled: {len(sampled_table):,} rows (max_rows={max_rows})")
        elif sample_fraction and sample_fraction < 1.0:
            # Random sample
            import random
            sample_size = max(1, int(source_rows * sample_fraction))
            indices = sorted(random.sample(range(source_rows), sample_size))
            sampled_table = table.take(indices)
            print(f"  Sampled: {len(sampled_table):,} rows (fraction={sample_fraction})")
        else:
            # Use all rows
            sampled_table = table
            print(f"  Using all rows")

        total_dest_rows += len(sampled_table)

        # Write to destination
        dest_file = dest_dir / source_file.name
        pq.write_table(
            sampled_table,
            dest_file,
            compression='snappy',
            use_dictionary=True,
        )

        dest_size = dest_file.stat().st_size / (1024 * 1024)
        print(f"  Written: {dest_file.name} ({dest_size:.2f} MB)")
        print()

    # Summary
    print(f"{'='*70}")
    print(f"TEST SNAPSHOT CREATED")
    print(f"{'='*70}")
    print(f"Source rows:      {total_source_rows:,}")
    print(f"Destination rows: {total_dest_rows:,}")
    print(f"Reduction:        {100 * (1 - total_dest_rows/total_source_rows):.1f}%")
    print(f"Location:         {dest_dir}")
    print(f"\nUse this snapshot:")
    print(f"  Frontend: http://localhost:3000/dashboard/{dest_date}")
    print(f"  API:      http://localhost:8000/api/snapshots/{dest_date}")
    print(f"{'='*70}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Create a test snapshot from a larger snapshot",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument('source_date', help='Source snapshot date (YYYY-MM-DD)')
    parser.add_argument('dest_date', help='Destination snapshot date (YYYY-MM-DD)')
    parser.add_argument('--rows', type=int, help='Maximum rows per file')
    parser.add_argument('--sample', type=float, help='Sample fraction (0.0 to 1.0)')
    parser.add_argument('--file', help='Use only this specific file')

    args = parser.parse_args()

    # Validate arguments
    if args.rows and args.sample:
        print("ERROR: Cannot specify both --rows and --sample")
        sys.exit(1)

    if args.sample and (args.sample <= 0 or args.sample > 1):
        print("ERROR: --sample must be between 0 and 1")
        sys.exit(1)

    create_test_snapshot(
        args.source_date,
        args.dest_date,
        max_rows=args.rows,
        sample_fraction=args.sample,
        specific_file=args.file
    )


if __name__ == "__main__":
    main()
