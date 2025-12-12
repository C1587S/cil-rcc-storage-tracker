#!/usr/bin/env python3
"""
Aggregate Scanner Parquet Chunks

This script consolidates multiple Parquet chunks from the scanner output
into a single Parquet file per scan directory, ready for backend import.

The scanner outputs data in chunks (e.g., chunk_0001.parquet, chunk_0002.parquet, etc.)
This script merges all chunks for each scanned directory into one consolidated file.

Usage:
    # Process all subdirectories in scan output
    python aggregate_scan_chunks.py /Volumes/cil/.../cil_scans /Volumes/cil/.../cil_scans_aggregated 2025-12-12

    # Process a single subdirectory
    python aggregate_scan_chunks.py /Volumes/cil/.../cil_scans/beagle /tmp/aggregated/beagle.parquet

Directory Structure:
    Input:  cil_scans/beagle/chunk_0001.parquet, chunk_0002.parquet, ...
    Output: cil_scans_aggregated/2025-12-12/beagle.parquet

The output format matches what the backend expects:
    backend/data/snapshots/{date}/{directory}.parquet
"""

import sys
import os
from pathlib import Path
from datetime import datetime
import pyarrow.parquet as pq
import pyarrow as pa
from typing import List, Optional
import json


def validate_date(date_str: str) -> bool:
    """Validate date format (YYYY-MM-DD)"""
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def find_parquet_chunks(directory: Path) -> List[Path]:
    """
    Find all parquet chunk files in a directory.

    Args:
        directory: Directory to search

    Returns:
        Sorted list of parquet chunk files
    """
    # Look for chunk files (e.g., chunk_0001.parquet, snapshot_*_chunk_*.parquet)
    chunk_patterns = [
        "chunk_*.parquet",
        "*_chunk_*.parquet",
        "*.parquet"
    ]

    files = []
    for pattern in chunk_patterns:
        found = list(directory.glob(pattern))
        if found:
            # Exclude manifest files
            files = [f for f in found if 'manifest' not in f.name.lower()]
            break

    # Sort to ensure consistent ordering
    return sorted(files)


def get_parquet_stats(file_path: Path) -> dict:
    """Get statistics about a parquet file"""
    table = pq.read_table(file_path)
    return {
        'rows': len(table),
        'columns': len(table.column_names),
        'size_bytes': file_path.stat().st_size,
        'schema': table.schema
    }


def consolidate_chunks(chunk_files: List[Path], output_file: Path, progress_callback=None) -> dict:
    """
    Consolidate multiple parquet chunks into a single file.

    Args:
        chunk_files: List of parquet chunk files to consolidate
        output_file: Output parquet file path
        progress_callback: Optional callback function for progress updates

    Returns:
        Dictionary with consolidation statistics
    """
    if not chunk_files:
        raise ValueError("No chunk files provided")

    print(f"  Reading {len(chunk_files)} chunk file(s)...")

    # Read all chunks
    tables = []
    total_rows = 0

    for i, chunk_file in enumerate(chunk_files, 1):
        if progress_callback:
            progress_callback(i, len(chunk_files), chunk_file.name)
        else:
            print(f"    [{i}/{len(chunk_files)}] Reading {chunk_file.name}...", end='\r')

        table = pq.read_table(chunk_file)
        tables.append(table)
        total_rows += len(table)

    print(f"\n  Consolidating {total_rows:,} rows...")

    # Concatenate all tables
    consolidated = pa.concat_tables(tables)

    # Ensure output directory exists
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Write consolidated table
    print(f"  Writing to {output_file.name}...")
    pq.write_table(
        consolidated,
        output_file,
        compression='snappy',  # Good balance of speed and compression
        use_dictionary=True,   # Efficient for repeated strings (paths, types, etc.)
    )

    output_size = output_file.stat().st_size

    return {
        'input_files': len(chunk_files),
        'output_rows': len(consolidated),
        'output_columns': len(consolidated.column_names),
        'output_size_bytes': output_size,
        'output_size_mb': output_size / (1024 * 1024),
        'schema': consolidated.schema
    }


def aggregate_single_directory(scan_dir: Path, output_file: Path) -> dict:
    """
    Aggregate chunks from a single scan directory.

    Args:
        scan_dir: Directory containing parquet chunks
        output_file: Output consolidated parquet file

    Returns:
        Aggregation statistics
    """
    print(f"\n{'='*70}")
    print(f"Processing: {scan_dir.name}")
    print(f"{'='*70}")

    # Find chunk files
    chunk_files = find_parquet_chunks(scan_dir)

    if not chunk_files:
        print(f"  WARNING: No parquet chunks found in {scan_dir}")
        return None

    print(f"  Found {len(chunk_files)} chunk file(s)")

    # Check for manifest file
    manifest_files = list(scan_dir.glob("*manifest.json"))
    if manifest_files:
        print(f"  Found manifest: {manifest_files[0].name}")

    # Consolidate chunks
    stats = consolidate_chunks(chunk_files, output_file)

    # Print summary
    print(f"\n  Summary:")
    print(f"    Input chunks: {stats['input_files']}")
    print(f"    Total rows:   {stats['output_rows']:,}")
    print(f"    Columns:      {stats['output_columns']}")
    print(f"    Output size:  {stats['output_size_mb']:.2f} MB")
    print(f"    Output file:  {output_file}")

    return stats


def aggregate_all_directories(scan_root: Path, output_root: Path, snapshot_date: str) -> dict:
    """
    Aggregate all scan subdirectories in a scan root.

    Args:
        scan_root: Root directory containing scan subdirectories
        output_root: Root directory for aggregated outputs
        snapshot_date: Date identifier (YYYY-MM-DD)

    Returns:
        Dictionary mapping directory names to their statistics
    """
    print(f"\n{'='*70}")
    print(f"AGGREGATE SCANNER CHUNKS")
    print(f"{'='*70}")
    print(f"Scan Root:     {scan_root}")
    print(f"Output Root:   {output_root}")
    print(f"Snapshot Date: {snapshot_date}")
    print(f"{'='*70}")

    if not scan_root.exists():
        print(f"ERROR: Scan root does not exist: {scan_root}")
        sys.exit(1)

    if not scan_root.is_dir():
        print(f"ERROR: Scan root is not a directory: {scan_root}")
        sys.exit(1)

    # Find all subdirectories that contain parquet files
    scan_dirs = []
    for item in scan_root.iterdir():
        if item.is_dir():
            chunks = find_parquet_chunks(item)
            if chunks:
                scan_dirs.append(item)

    if not scan_dirs:
        print(f"ERROR: No scan directories with parquet files found in {scan_root}")
        sys.exit(1)

    print(f"\nFound {len(scan_dirs)} scan directory(ies):")
    for scan_dir in sorted(scan_dirs):
        chunks = find_parquet_chunks(scan_dir)
        print(f"  - {scan_dir.name}: {len(chunks)} chunk(s)")

    # Create output directory structure
    output_date_dir = output_root / snapshot_date
    output_date_dir.mkdir(parents=True, exist_ok=True)

    # Process each scan directory
    all_stats = {}

    for i, scan_dir in enumerate(sorted(scan_dirs), 1):
        print(f"\n[{i}/{len(scan_dirs)}]", end=' ')

        output_file = output_date_dir / f"{scan_dir.name}.parquet"
        stats = aggregate_single_directory(scan_dir, output_file)

        if stats:
            all_stats[scan_dir.name] = stats

    # Print overall summary
    print(f"\n{'='*70}")
    print(f"AGGREGATION COMPLETE")
    print(f"{'='*70}")
    print(f"Directories processed: {len(all_stats)}")
    print(f"Total rows:            {sum(s['output_rows'] for s in all_stats.values()):,}")
    print(f"Total size:            {sum(s['output_size_mb'] for s in all_stats.values()):.2f} MB")
    print(f"Output directory:      {output_date_dir}")
    print(f"\nOutput files:")
    for name, stats in sorted(all_stats.items()):
        print(f"  {name}.parquet: {stats['output_rows']:,} rows, {stats['output_size_mb']:.2f} MB")
    print(f"{'='*70}")

    # Save metadata
    metadata_file = output_date_dir / "_aggregation_metadata.json"
    metadata = {
        'snapshot_date': snapshot_date,
        'scan_root': str(scan_root),
        'output_root': str(output_root),
        'aggregated_at': datetime.now().isoformat(),
        'directories': {
            name: {
                'input_chunks': stats['input_files'],
                'output_rows': stats['output_rows'],
                'output_size_mb': round(stats['output_size_mb'], 2)
            }
            for name, stats in all_stats.items()
        }
    }

    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\nMetadata saved to: {metadata_file}")

    return all_stats


def main():
    """Main entry point"""

    if len(sys.argv) < 3:
        print("Usage:")
        print("  Aggregate all subdirectories:")
        print("    python aggregate_scan_chunks.py <scan_root> <output_root> <snapshot_date>")
        print("\n  Aggregate single directory:")
        print("    python aggregate_scan_chunks.py <scan_dir> <output_file.parquet>")
        print("\nExamples:")
        print("  # Process all CIL scan directories")
        print("  python aggregate_scan_chunks.py \\")
        print("    /Volumes/cil/.../cil_scans \\")
        print("    /Volumes/cil/.../cil_scans_aggregated \\")
        print("    2025-12-12")
        print("\n  # Process single directory")
        print("  python aggregate_scan_chunks.py \\")
        print("    /Volumes/cil/.../cil_scans/beagle \\")
        print("    /tmp/beagle.parquet")
        sys.exit(1)

    # Determine mode based on arguments
    if len(sys.argv) == 4:
        # Mode 1: Aggregate all subdirectories
        scan_root = Path(sys.argv[1])
        output_root = Path(sys.argv[2])
        snapshot_date = sys.argv[3]

        if not validate_date(snapshot_date):
            print(f"ERROR: Invalid snapshot date format. Use YYYY-MM-DD")
            sys.exit(1)

        aggregate_all_directories(scan_root, output_root, snapshot_date)

    elif len(sys.argv) == 3:
        # Mode 2: Aggregate single directory
        scan_dir = Path(sys.argv[1])
        output_file = Path(sys.argv[2])

        if not scan_dir.exists() or not scan_dir.is_dir():
            print(f"ERROR: Scan directory does not exist or is not a directory: {scan_dir}")
            sys.exit(1)

        aggregate_single_directory(scan_dir, output_file)

    else:
        print("ERROR: Invalid number of arguments")
        sys.exit(1)


if __name__ == "__main__":
    main()
