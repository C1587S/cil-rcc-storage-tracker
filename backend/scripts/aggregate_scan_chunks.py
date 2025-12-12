#!/usr/bin/env python3
"""
Aggregate Scanner Parquet Chunks (Date-Aware)

This script consolidates multiple Parquet chunks from the scanner output
into a single Parquet file per scan directory and snapshot date.

Supported directory layout:

    cil_scans/<dataset>/<YYYY-MM-DD>/*.parquet

Output layout:

    cil_scans_aggregated/<YYYY-MM-DD>/<dataset>.parquet
"""

import sys
import json
from pathlib import Path
from datetime import datetime
from typing import List

import pyarrow.parquet as pq
import pyarrow as pa


def validate_date(date_str: str) -> bool:
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def find_parquet_chunks(directory: Path) -> List[Path]:
    patterns = [
        "*_chunk_*.parquet",
        "chunk_*.parquet",
        "*.parquet",
    ]

    files = []
    for pattern in patterns:
        found = list(directory.glob(pattern))
        if found:
            files = [f for f in found if "manifest" not in f.name.lower()]
            break

    return sorted(files)


def consolidate_chunks(chunk_files: List[Path], output_file: Path) -> dict:
    if not chunk_files:
        raise ValueError("No chunk files provided")

    print(f"  Reading {len(chunk_files)} chunk file(s)...")

    tables = []
    total_rows = 0

    for i, chunk_file in enumerate(chunk_files, 1):
        print(f"    [{i}/{len(chunk_files)}] {chunk_file.name}", end="\r")
        table = pq.read_table(chunk_file)
        tables.append(table)
        total_rows += len(table)

    print(f"\n  Consolidating {total_rows:,} rows...")

    consolidated = pa.concat_tables(tables)

    output_file.parent.mkdir(parents=True, exist_ok=True)

    print(f"  Writing {output_file}...")
    pq.write_table(
        consolidated,
        output_file,
        compression="snappy",
        use_dictionary=True,
    )

    size_bytes = output_file.stat().st_size

    return {
        "input_files": len(chunk_files),
        "output_rows": len(consolidated),
        "output_columns": len(consolidated.column_names),
        "output_size_mb": size_bytes / (1024 * 1024),
        "schema": consolidated.schema,
    }


def aggregate_single_directory(scan_dir: Path, output_file: Path) -> dict:
    print(f"\n{'=' * 70}")
    print(f"Processing: {scan_dir}")
    print(f"{'=' * 70}")

    chunk_files = find_parquet_chunks(scan_dir)
    if not chunk_files:
        print(f"  WARNING: No parquet chunks found in {scan_dir}")
        return None

    print(f"  Found {len(chunk_files)} chunk file(s)")
    return consolidate_chunks(chunk_files, output_file)


def aggregate_all_directories(scan_root: Path, output_root: Path, snapshot_date: str) -> dict:
    print(f"\n{'=' * 70}")
    print("AGGREGATE SCANNER CHUNKS (DATE-AWARE)")
    print(f"{'=' * 70}")
    print(f"Scan Root:     {scan_root}")
    print(f"Snapshot Date: {snapshot_date}")
    print(f"Output Root:   {output_root}")
    print(f"{'=' * 70}")

    if not scan_root.exists() or not scan_root.is_dir():
        print(f"ERROR: Invalid scan root: {scan_root}")
        sys.exit(1)

    scan_targets = []

    for dataset_dir in scan_root.iterdir():
        if not dataset_dir.is_dir():
            continue

        date_dir = dataset_dir / snapshot_date
        if not date_dir.is_dir():
            continue

        chunks = find_parquet_chunks(date_dir)
        if chunks:
            scan_targets.append((dataset_dir.name, date_dir))

    if not scan_targets:
        print(f"ERROR: No parquet chunks found for date {snapshot_date}")
        sys.exit(1)

    print(f"\nFound {len(scan_targets)} dataset(s):")
    for name, date_dir in scan_targets:
        print(f"  - {name}: {len(find_parquet_chunks(date_dir))} chunk(s)")

    output_date_dir = output_root / snapshot_date
    output_date_dir.mkdir(parents=True, exist_ok=True)

    all_stats = {}

    for i, (dataset_name, date_dir) in enumerate(scan_targets, 1):
        print(f"\n[{i}/{len(scan_targets)}] Dataset: {dataset_name}")
        output_file = output_date_dir / f"{dataset_name}.parquet"
        stats = aggregate_single_directory(date_dir, output_file)
        if stats:
            all_stats[dataset_name] = stats

    print(f"\n{'=' * 70}")
    print("AGGREGATION COMPLETE")
    print(f"{'=' * 70}")
    print(f"Datasets processed: {len(all_stats)}")
    print(f"Total rows: {sum(s['output_rows'] for s in all_stats.values()):,}")
    print(f"Total size: {sum(s['output_size_mb'] for s in all_stats.values()):.2f} MB")
    print(f"Output directory: {output_date_dir}")

    metadata = {
        "snapshot_date": snapshot_date,
        "scan_root": str(scan_root),
        "aggregated_at": datetime.now().isoformat(),
        "directories": {
            name: {
                "input_chunks": stats["input_files"],
                "output_rows": stats["output_rows"],
                "output_size_mb": round(stats["output_size_mb"], 2),
            }
            for name, stats in all_stats.items()
        },
    }

    metadata_file = output_date_dir / "_aggregation_metadata.json"
    with open(metadata_file, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\nMetadata saved to: {metadata_file}")
    return all_stats


def main():
    if len(sys.argv) < 3:
        print("Usage:")
        print("  Aggregate all datasets for a date:")
        print("    python aggregate_scan_chunks.py <scan_root> <output_root> <YYYY-MM-DD>")
        print("")
        print("  Aggregate a single directory:")
        print("    python aggregate_scan_chunks.py <scan_dir> <output_file.parquet>")
        sys.exit(1)

    if len(sys.argv) == 4:
        scan_root = Path(sys.argv[1])
        output_root = Path(sys.argv[2])
        snapshot_date = sys.argv[3]

        if not validate_date(snapshot_date):
            print("ERROR: Invalid date format. Use YYYY-MM-DD")
            sys.exit(1)

        aggregate_all_directories(scan_root, output_root, snapshot_date)

    elif len(sys.argv) == 3:
        scan_dir = Path(sys.argv[1])
        output_file = Path(sys.argv[2])

        if not scan_dir.exists() or not scan_dir.is_dir():
            print(f"ERROR: Invalid scan directory: {scan_dir}")
            sys.exit(1)

        aggregate_single_directory(scan_dir, output_file)

    else:
        print("ERROR: Invalid number of arguments")
        sys.exit(1)


if __name__ == "__main__":
    main()
