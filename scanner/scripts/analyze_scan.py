#!/usr/bin/env python3

"""
Analyze a parquet scan output and compare with du results (macOS + Linux compatible)
"""

import argparse
import subprocess
import sys
from pathlib import Path
import shutil

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required. Install with: pip install pandas pyarrow")
    sys.exit(1)


def format_bytes(bytes_val):
    """Format bytes in human-readable format"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_val < 1024.0:
            return f"{bytes_val:.2f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.2f} PB"


def get_du_size(path):
    """
    Portable du implementation:

    - If `gdu` exists (GNU coreutils), use:     gdu -sb <path>
    - Otherwise on macOS, fallback to:         du -sk <path> (KB → bytes)
    - On Linux, system `du -sb` works.
    """

    # Prefer GNU du if installed (brew install coreutils)
    if shutil.which("gdu"):
        try:
            result = subprocess.run(
                ["gdu", "-sb", path],
                capture_output=True, text=True, check=True
            )
            return int(result.stdout.split()[0])
        except Exception as e:
            print(f"[WARN] gdu failed unexpectedly: {e}")

    # Try system du with -sb (Linux)
    try:
        result = subprocess.run(
            ["du", "-sb", path],
            capture_output=True, text=True, check=True
        )
        return int(result.stdout.split()[0])
    except Exception:
        # Fallback for macOS
        pass

    # macOS fallback: du -sk (KB)
    try:
        result = subprocess.run(
            ["du", "-sk", path],
            capture_output=True, text=True, check=True
        )
        kb = int(result.stdout.split()[0])
        return kb * 1024
    except Exception as e:
        print(f"Could not run du command: {e}")
        return None


def analyze_parquet(parquet_file, original_path=None):
    """Analyze a parquet scan output"""

    print("=" * 60)
    print("Scanner Output Analysis")
    print("=" * 60)
    print()

    # Read parquet file
    try:
        df = pd.read_parquet(parquet_file)
    except Exception as e:
        print(f"Error reading parquet file: {e}")
        return

    # Basic statistics
    total_entries = len(df)

    print(f"Parquet file: {parquet_file}")
    print(f"Total entries: {total_entries:,}")
    print()

    # Separate files and directories
    dirs = df[df['file_type'] == 'directory']
    files = df[df['file_type'] != 'directory']

    print(f"Directories: {len(dirs):,}")
    print(f"Files: {len(files):,}")
    print()

    # Size statistics (files only)
    file_size_total = files['size'].sum()

    print("=" * 60)
    print("Size Analysis (Files Only)")
    print("=" * 60)
    print(f"Total file size: {format_bytes(file_size_total)}")
    print(f"Total file size (bytes): {file_size_total:,}")
    print()

    # File types by count
    print("Top 10 File Types by Count:")
    print(files['file_type'].value_counts().head(10))
    print()

    # Size by file type
    print("Top 10 File Types by Total Size:")
    size_by_type = files.groupby('file_type')['size'].sum().sort_values(ascending=False).head(10)
    for ftype, size in size_by_type.items():
        print(f"  {ftype:20} {format_bytes(size):>12}")
    print()

    # Largest files
    print("Top 10 Largest Files:")
    largest = files.nlargest(10, 'size')
    for _, row in largest.iterrows():
        filename = Path(row['path']).name
        print(f"  {format_bytes(row['size']):>12}  {row['file_type']:10}  {filename}")
    print()

    # Compare with du
    if original_path:
        print("=" * 60)
        print("Comparison with 'du' command")
        print("=" * 60)

        du_bytes = get_du_size(original_path)

        if du_bytes is None:
            print("Could not compute du size.")
        else:
            # human readable du
            du_readable = subprocess.run(
                ["du", "-sh", original_path],
                capture_output=True, text=True
            ).stdout.split()[0]

            print(f"Scanner total (files only): {format_bytes(file_size_total)}")
            print(f"du -sh result:              {du_readable}")
            print(f"du (bytes estimated):       {du_bytes:,}")
            print()

            difference = du_bytes - file_size_total
            percentage = abs(difference) / du_bytes * 100 if du_bytes > 0 else 0

            print(f"Difference: {format_bytes(abs(difference))} ({percentage:.2f}%)")
            print()

    # Summary
    print("=" * 60)
    print("Summary Statistics")
    print("=" * 60)
    print(f"Average file size: {format_bytes(files['size'].mean())}")
    print(f"Median file size: {format_bytes(files['size'].median())}")
    print(f"Smallest file: {format_bytes(files['size'].min())}")
    print(f"Largest file: {format_bytes(files['size'].max())}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Analyze storage scanner parquet output and compare with du"
    )
    parser.add_argument("parquet_file", type=str, help="Parquet file path")
    parser.add_argument("--path", type=str, help="Original scanned path (for du comparison)")

    args = parser.parse_args()

    parquet_path = Path(args.parquet_file)
    if not parquet_path.exists():
        print(f"Error: Parquet file not found: {parquet_path}")
        sys.exit(1)

    analyze_parquet(parquet_path, args.path)


if __name__ == "__main__":
    main()
