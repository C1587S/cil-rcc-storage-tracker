#!/usr/bin/env python3
"""
Import Parquet Snapshot to Backend (OOM-safe)

This script imports parquet snapshot files into the backend data directory
without loading full datasets into memory.
"""

import sys
import shutil
from pathlib import Path
from datetime import datetime
import pyarrow.parquet as pq


REQUIRED_COLS = {"path", "size", "modified_time", "file_type"}


def validate_snapshot_date(date_str: str) -> bool:
    """
    Validate snapshot date format.
    Accepts: YYYY-MM-DD
    """
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def parquet_metadata_info(pq_file: Path):
    pf = pq.ParquetFile(pq_file)
    schema = pf.schema_arrow
    rows = pf.metadata.num_rows
    return schema, rows


def import_snapshot(source_dir: str, snapshot_date: str, data_root: str = None):
    if data_root is None:
        script_dir = Path(__file__).parent
        backend_dir = script_dir.parent
        data_root = backend_dir / "data" / "snapshots"
    else:
        data_root = Path(data_root)

    source_path = Path(source_dir)
    dest_path = data_root / snapshot_date

    print("=" * 60)
    print("PARQUET SNAPSHOT IMPORT (STREAMING SAFE)")
    print("=" * 60)
    print(f"Source: {source_path}")
    print(f"Destination: {dest_path}")
    print(f"Snapshot Date: {snapshot_date}")
    print()

    if not source_path.exists() or not source_path.is_dir():
        print(f"ERROR: Invalid source directory: {source_path}")
        sys.exit(1)

    if not validate_snapshot_date(snapshot_date):
        print("ERROR: Invalid snapshot date format (expected: YYYY-MM-DD)")
        sys.exit(1)

    parquet_files = sorted(source_path.glob("*.parquet"))
    if not parquet_files:
        print("ERROR: No parquet files found in source directory")
        sys.exit(1)

    print(f"Found {len(parquet_files)} parquet file(s)")

    # ---- VALIDATION (METADATA ONLY) ----
    print("\nValidating parquet files (metadata only)...")
    total_rows = 0

    for pq_file in parquet_files:
        try:
            schema, rows = parquet_metadata_info(pq_file)
            total_rows += rows

            actual_cols = set(schema.names)
            missing = REQUIRED_COLS - actual_cols
            if missing:
                print(f"  WARNING: {pq_file.name} missing columns: {missing}")

            print(f"  ✓ {pq_file.name}: {rows:,} rows")

        except Exception as e:
            print(f"  ✗ {pq_file.name}: ERROR - {e}")
            sys.exit(1)

    # ---- DESTINATION HANDLING ----
    if dest_path.exists():
        print(f"\nWARNING: Destination already exists: {dest_path}")

        if not sys.stdin.isatty():
            response = "yes"
            print("Non-interactive mode: auto-overwrite")
        else:
            response = input("Overwrite existing snapshot? (yes/no): ")

        if response.lower() != "yes":
            print("Import cancelled")
            sys.exit(0)

        print("Removing existing snapshot...")
        shutil.rmtree(dest_path)

    dest_path.mkdir(parents=True, exist_ok=True)

    # ---- COPY FILES (OS STREAMING) ----
    print("\nCopying files...")
    for pq_file in parquet_files:
        dest_file = dest_path / pq_file.name
        print(f"  Copying: {pq_file.name}")
        shutil.copy2(pq_file, dest_file)

    # ---- VERIFY COPIED FILES (METADATA ONLY) ----
    print("\nVerifying copied files...")
    verified_rows = 0

    for pq_file in dest_path.glob("*.parquet"):
        try:
            _, rows = parquet_metadata_info(pq_file)
            verified_rows += rows
            print(f"  ✓ {pq_file.name}: {rows:,} rows")
        except Exception as e:
            print(f"  ✗ {pq_file.name}: ERROR - {e}")
            sys.exit(1)

    print("\n" + "=" * 60)
    print("IMPORT SUCCESSFUL")
    print("=" * 60)
    print(f"Snapshot Date: {snapshot_date}")
    print(f"Files Imported: {len(parquet_files)}")
    print(f"Total Rows: {verified_rows:,}")
    print(f"Location: {dest_path}")
    print("=" * 60)
    print()

    # ---- RUN OPTIMIZATION ----
    print("=" * 60)
    print("RUNNING SNAPSHOT OPTIMIZATION")
    print("=" * 60)
    print()
    print("Creating materialized tables for fast queries...")
    print("This is CRITICAL for performance with large snapshots (1M+ files).")
    print("This may take several minutes but will reduce query times from 55+ minutes to seconds.")
    print()

    try:
        # Import and run optimization
        sys.path.insert(0, str(Path(__file__).parent))
        from optimize_snapshot import optimize_snapshot
        optimize_snapshot(snapshot_date)

        print()
        print("=" * 60)
        print("SNAPSHOT READY FOR USE")
        print("=" * 60)
        print()
        print("Your snapshot has been imported and optimized!")
        print(f"Start the backend and navigate to: /dashboard/{snapshot_date}")
        print()

    except Exception as e:
        print()
        print("=" * 60)
        print("WARNING: Optimization failed")
        print("=" * 60)
        print(f"Error: {e}")
        print()
        print("The snapshot was imported successfully, but optimization failed.")
        print("You can manually optimize later by running:")
        print(f"  python scripts/optimize_snapshot.py {snapshot_date}")
        print()
        print("WARNING: Without optimization, queries may be VERY slow (55+ minutes).")
        print("=" * 60)


def list_snapshots(data_root: str = None):
    if data_root is None:
        script_dir = Path(__file__).parent
        backend_dir = script_dir.parent
        data_root = backend_dir / "data" / "snapshots"
    else:
        data_root = Path(data_root)

    print("=" * 60)
    print("AVAILABLE SNAPSHOTS")
    print("=" * 60)

    if not data_root.exists():
        print("No snapshots directory found")
        return

    for snapshot_dir in sorted(d for d in data_root.iterdir() if d.is_dir()):
        parquet_files = list(snapshot_dir.glob("*.parquet"))
        total_rows = 0

        for pq_file in parquet_files:
            try:
                _, rows = parquet_metadata_info(pq_file)
                total_rows += rows
            except:
                pass

        print(f"\n{snapshot_dir.name}")
        print(f"  Files: {len(parquet_files)}")
        print(f"  Rows: {total_rows:,}")

    print("=" * 60)


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python import_snapshot.py <source_dir> <snapshot_date>")
        print("  python import_snapshot.py --list")
        sys.exit(1)

    if sys.argv[1] == "--list":
        list_snapshots()
        sys.exit(0)

    if len(sys.argv) != 3:
        print("ERROR: Invalid arguments")
        sys.exit(1)

    import_snapshot(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
