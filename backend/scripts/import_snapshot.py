#!/usr/bin/env python3
"""
Import Parquet Snapshot to Backend

This script imports parquet snapshot files into the backend data directory
so they can be queried by DuckDB through the API.

Usage:
    python import_snapshot.py <source_dir> <snapshot_date>
    python import_snapshot.py /path/to/parquet/files 2024-01-15

The script will:
1. Validate the parquet files
2. Copy them to the backend data directory
3. Organize them by snapshot date
4. Verify they're readable by DuckDB
"""

import sys
import os
import shutil
from pathlib import Path
from datetime import datetime
import pyarrow.parquet as pq


def validate_snapshot_date(date_str: str) -> bool:
    """Validate snapshot date format (YYYY-MM-DD)"""
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def import_snapshot(source_dir: str, snapshot_date: str, data_root: str = None):
    """
    Import parquet files from source directory to backend data directory

    Args:
        source_dir: Directory containing parquet files
        snapshot_date: Date identifier for snapshot (YYYY-MM-DD)
        data_root: Root directory for snapshots (defaults to backend/data/snapshots)
    """
    # Determine data root
    if data_root is None:
        # Assume script is in backend/scripts/
        script_dir = Path(__file__).parent
        backend_dir = script_dir.parent
        data_root = backend_dir / "data" / "snapshots"
    else:
        data_root = Path(data_root)

    source_path = Path(source_dir)
    dest_path = data_root / snapshot_date

    print("=" * 60)
    print("PARQUET SNAPSHOT IMPORT")
    print("=" * 60)
    print(f"Source: {source_path}")
    print(f"Destination: {dest_path}")
    print(f"Snapshot Date: {snapshot_date}")
    print()

    # Validate inputs
    if not source_path.exists():
        print(f"ERROR: Source directory does not exist: {source_path}")
        sys.exit(1)

    if not source_path.is_dir():
        print(f"ERROR: Source path is not a directory: {source_path}")
        sys.exit(1)

    if not validate_snapshot_date(snapshot_date):
        print(f"ERROR: Invalid snapshot date format. Use YYYY-MM-DD")
        sys.exit(1)

    # Find parquet files
    parquet_files = list(source_path.glob("*.parquet"))

    if not parquet_files:
        print("ERROR: No parquet files found in source directory")
        sys.exit(1)

    print(f"Found {len(parquet_files)} parquet file(s)")

    # Validate parquet files
    print("\nValidating parquet files...")
    for pq_file in parquet_files:
        try:
            table = pq.read_table(pq_file)
            rows = len(table)
            print(f"  ✓ {pq_file.name}: {rows:,} rows")

            # Check for required columns
            required_cols = {'path', 'size', 'modified_time', 'file_type'}
            actual_cols = set(table.column_names)

            if not required_cols.issubset(actual_cols):
                missing = required_cols - actual_cols
                print(f"    WARNING: Missing columns: {missing}")

        except Exception as e:
            print(f"  ✗ {pq_file.name}: ERROR - {str(e)}")
            sys.exit(1)

    # Check if destination already exists
    if dest_path.exists():
        print(f"\nWARNING: Destination already exists: {dest_path}")

        # Check if running in non-interactive mode (automation script)
        import sys
        if not sys.stdin.isatty():
            print("Running in non-interactive mode - automatically overwriting")
            response = 'yes'
        else:
            response = input("Overwrite existing snapshot? (yes/no): ")

        if response.lower() != 'yes':
            print("Import cancelled")
            sys.exit(0)

        print("Removing existing snapshot...")
        shutil.rmtree(dest_path)

    # Create destination directory
    print(f"\nCreating destination directory...")
    dest_path.mkdir(parents=True, exist_ok=True)

    # Copy files
    print("\nCopying files...")
    for pq_file in parquet_files:
        dest_file = dest_path / pq_file.name
        print(f"  Copying: {pq_file.name}")
        shutil.copy2(pq_file, dest_file)

    # Verify copied files
    print("\nVerifying copied files...")
    total_rows = 0
    for pq_file in dest_path.glob("*.parquet"):
        try:
            table = pq.read_table(pq_file)
            rows = len(table)
            total_rows += rows
            print(f"  ✓ {pq_file.name}: {rows:,} rows")
        except Exception as e:
            print(f"  ✗ {pq_file.name}: ERROR - {str(e)}")
            sys.exit(1)

    # Summary
    print("\n" + "=" * 60)
    print("IMPORT SUCCESSFUL")
    print("=" * 60)
    print(f"Snapshot Date: {snapshot_date}")
    print(f"Files Imported: {len(parquet_files)}")
    print(f"Total Rows: {total_rows:,}")
    print(f"Location: {dest_path}")
    print("\nThe snapshot is now available to the backend API.")
    print("=" * 60)


def list_snapshots(data_root: str = None):
    """List all available snapshots"""

    if data_root is None:
        script_dir = Path(__file__).parent
        backend_dir = script_dir.parent
        data_root = backend_dir / "data" / "snapshots"
    else:
        data_root = Path(data_root)

    if not data_root.exists():
        print(f"No snapshots directory found: {data_root}")
        return

    snapshots = sorted([d.name for d in data_root.iterdir() if d.is_dir()])

    print("=" * 60)
    print("AVAILABLE SNAPSHOTS")
    print("=" * 60)

    if not snapshots:
        print("No snapshots found")
    else:
        for snapshot in snapshots:
            snapshot_path = data_root / snapshot
            parquet_files = list(snapshot_path.glob("*.parquet"))
            total_rows = 0

            for pq_file in parquet_files:
                try:
                    table = pq.read_table(pq_file)
                    total_rows += len(table)
                except:
                    pass

            print(f"\n{snapshot}")
            print(f"  Files: {len(parquet_files)}")
            print(f"  Rows: {total_rows:,}")

    print("=" * 60)


def main():
    """Main entry point"""

    if len(sys.argv) < 2:
        print("Usage:")
        print("  Import snapshot:")
        print("    python import_snapshot.py <source_dir> <snapshot_date>")
        print("\n  List snapshots:")
        print("    python import_snapshot.py --list")
        print("\nExamples:")
        print("  python import_snapshot.py /tmp/scan_output 2024-01-15")
        print("  python import_snapshot.py ~/Downloads/snapshot_2024_01_15 2024-01-15")
        print("  python import_snapshot.py --list")
        sys.exit(1)

    # Handle --list command
    if sys.argv[1] == "--list":
        list_snapshots()
        sys.exit(0)

    # Handle import command
    if len(sys.argv) != 3:
        print("ERROR: Invalid arguments")
        print("Usage: python import_snapshot.py <source_dir> <snapshot_date>")
        sys.exit(1)

    source_dir = sys.argv[1]
    snapshot_date = sys.argv[2]

    import_snapshot(source_dir, snapshot_date)


if __name__ == "__main__":
    main()
