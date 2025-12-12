#!/usr/bin/env python3
"""
Check Environment Configuration

Verifies that paths are correctly resolved for the current environment.
Use this to debug path resolution issues.

Usage:
    python scripts/check_environment.py
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings


def check_path_exists(path: Path, name: str) -> bool:
    """Check if a path exists and print status."""
    exists = path.exists()
    status = "✓" if exists else "✗"
    print(f"  {status} {name}: {path}")
    if exists and path.is_dir():
        try:
            # Count parquet files if it's a directory
            parquet_files = list(path.glob("**/*.parquet"))
            if parquet_files:
                print(f"    → Found {len(parquet_files)} Parquet file(s)")
        except PermissionError:
            print(f"    → Permission denied")
    return exists


def main():
    print("="*70)
    print("ENVIRONMENT CONFIGURATION CHECK")
    print("="*70)

    settings = get_settings()

    # Environment detection
    print(f"\n📍 Environment: {settings.get_environment_name()}")

    # Data root
    print(f"\n📁 Data Root Path:")
    data_root = settings.get_data_root()
    data_root_exists = check_path_exists(data_root, "Data Root")

    # Snapshots path
    print(f"\n📦 Snapshots Path:")
    print(f"  Configured: {settings.snapshots_path}")
    snapshots = settings.get_absolute_snapshots_path()
    snapshots_exists = check_path_exists(snapshots, "Resolved")

    if snapshots_exists:
        # List snapshot dates
        try:
            snapshot_dirs = [d for d in snapshots.iterdir() if d.is_dir() and d.name.count('-') == 2]
            if snapshot_dirs:
                print(f"    → Available snapshots:")
                for snap_dir in sorted(snapshot_dirs):
                    parquet_files = list(snap_dir.glob("*.parquet"))
                    print(f"      • {snap_dir.name}: {len(parquet_files)} file(s)")
        except PermissionError:
            print(f"    → Cannot list snapshots (permission denied)")

    # Database path
    print(f"\n💾 Database Path:")
    print(f"  Configured: {settings.duckdb_path}")
    db_path = settings.get_absolute_db_path()
    db_exists = check_path_exists(db_path, "Resolved")

    if db_exists:
        import os
        size = os.path.getsize(db_path)
        size_mb = size / (1024 * 1024)
        print(f"    → Size: {size_mb:.2f} MB")

    # Configuration source
    print(f"\n⚙️  Configuration Source:")
    env_file = Path(__file__).parent.parent / ".env"
    env_exists = env_file.exists()
    if env_exists:
        print(f"  ✓ Using .env file: {env_file}")
        # Show relevant settings from .env
        with open(env_file) as f:
            relevant_lines = [
                line.strip() for line in f
                if line.strip() and not line.startswith('#')
                and any(key in line for key in ['DATA_ROOT', 'SNAPSHOTS_PATH', 'DUCKDB_PATH'])
            ]
            if relevant_lines:
                print(f"  Relevant settings:")
                for line in relevant_lines:
                    print(f"    {line}")
    else:
        print(f"  ℹ️  No .env file (using defaults)")

    # Summary
    print(f"\n{'='*70}")
    print(f"SUMMARY")
    print(f"{'='*70}")

    all_ok = data_root_exists and snapshots_exists

    if all_ok:
        print(f"✅ All paths exist and are accessible")
        print(f"\nYou can start the backend:")
        print(f"  cd backend")
        print(f"  python -m uvicorn app.main:app --reload --port 8000")
    else:
        print(f"❌ Some paths are missing or inaccessible")
        print(f"\nTroubleshooting:")

        if not data_root_exists:
            print(f"  1. Data root not found: {data_root}")
            print(f"     • If using cluster data, ensure /Volumes/cil is mounted")
            print(f"     • Or set DATA_ROOT_PATH in backend/.env")

        if not snapshots_exists:
            print(f"  2. Snapshots directory not found: {snapshots}")
            print(f"     • Check that snapshots are imported")
            print(f"     • Run: python backend/scripts/import_snapshot.py --list")
            print(f"     • Or set SNAPSHOTS_PATH in backend/.env")

    print(f"{'='*70}\n")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
