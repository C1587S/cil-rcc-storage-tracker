#!/usr/bin/env python3
"""
End-to-End Scanner Processing Pipeline

This script automates the complete workflow from scanner output to backend-ready data:
1. Aggregate scanner chunk files into consolidated parquet files
2. Import consolidated files into the backend data directory
3. Optimize the snapshot for fast querying

This is the recommended way to process new scanner outputs.

Usage:
    python process_scan_pipeline.py <scan_root> <snapshot_date> [options]

Examples:
    # Process CIL scans with default settings
    python process_scan_pipeline.py \\
        /Volumes/cil/.../cil_scans \\
        2025-12-12

    # Use custom output directory for aggregated files
    python process_scan_pipeline.py \\
        /Volumes/cil/.../cil_scans \\
        2025-12-12 \\
        --aggregated-dir /tmp/cil_scans_aggregated

    # Skip optimization step (faster, but queries will be slower)
    python process_scan_pipeline.py \\
        /Volumes/cil/.../cil_scans \\
        2025-12-12 \\
        --skip-optimize

    # Import directly to backend (skip aggregation if already done)
    python process_scan_pipeline.py \\
        --import-only \\
        /Volumes/cil/.../cil_scans_aggregated/2025-12-12 \\
        2025-12-12
"""

import sys
import os
import argparse
from pathlib import Path
from datetime import datetime
import subprocess
import shutil


class PipelineConfig:
    """Configuration for the processing pipeline"""

    def __init__(self, args):
        self.scan_root = Path(args.scan_root)
        self.snapshot_date = args.snapshot_date
        self.skip_aggregate = args.skip_aggregate or args.import_only
        self.skip_import = args.skip_import
        self.skip_optimize = args.skip_optimize
        self.import_only = args.import_only

        # Determine aggregated directory
        if args.aggregated_dir:
            self.aggregated_root = Path(args.aggregated_dir)
        else:
            # Default: create cil_scans_aggregated next to cil_scans
            self.aggregated_root = self.scan_root.parent / f"{self.scan_root.name}_aggregated"

        self.aggregated_date_dir = self.aggregated_root / self.snapshot_date

        # Determine backend data directory
        script_dir = Path(__file__).parent
        backend_dir = script_dir.parent
        self.backend_data_root = backend_dir / "data" / "snapshots"

        # Script paths
        self.aggregate_script = script_dir / "aggregate_scan_chunks.py"
        self.import_script = script_dir / "import_snapshot.py"
        self.optimize_script = script_dir / "optimize_snapshot.py"

    def validate(self) -> bool:
        """Validate configuration"""
        errors = []

        if self.import_only:
            # In import-only mode, scan_root is actually the aggregated directory
            if not self.scan_root.exists():
                errors.append(f"Aggregated directory does not exist: {self.scan_root}")
        else:
            if not self.scan_root.exists():
                errors.append(f"Scan root does not exist: {self.scan_root}")

        try:
            datetime.strptime(self.snapshot_date, "%Y-%m-%d")
        except ValueError:
            errors.append(f"Invalid date format (use YYYY-MM-DD): {self.snapshot_date}")

        if not self.aggregate_script.exists():
            errors.append(f"Aggregation script not found: {self.aggregate_script}")

        if not self.import_script.exists():
            errors.append(f"Import script not found: {self.import_script}")

        if not self.skip_optimize and not self.optimize_script.exists():
            errors.append(f"Optimization script not found: {self.optimize_script}")

        if errors:
            for error in errors:
                print(f"ERROR: {error}")
            return False

        return True

    def print_summary(self):
        """Print configuration summary"""
        print(f"\n{'='*70}")
        print(f"SCANNER PROCESSING PIPELINE")
        print(f"{'='*70}")
        print(f"Snapshot Date:      {self.snapshot_date}")

        if self.import_only:
            print(f"Mode:               Import Only")
            print(f"Source Directory:   {self.scan_root}")
        else:
            print(f"Scan Root:          {self.scan_root}")
            print(f"Aggregated Output:  {self.aggregated_date_dir}")

        print(f"Backend Data Dir:   {self.backend_data_root / self.snapshot_date}")
        print(f"\nPipeline Steps:")
        print(f"  1. Aggregate chunks:  {'SKIP' if self.skip_aggregate else 'YES'}")
        print(f"  2. Import to backend: {'SKIP' if self.skip_import else 'YES'}")
        print(f"  3. Optimize:          {'SKIP' if self.skip_optimize else 'YES'}")
        print(f"{'='*70}\n")


def run_command(cmd: list, description: str, allow_failure: bool = False) -> bool:
    """
    Run a command and handle output.

    Args:
        cmd: Command to run as list of strings
        description: Description of the command
        allow_failure: If True, don't exit on failure

    Returns:
        True if successful, False otherwise
    """
    print(f"\n{'='*70}")
    print(f"STEP: {description}")
    print(f"{'='*70}")
    print(f"Command: {' '.join(str(c) for c in cmd)}\n")

    result = subprocess.run(cmd, capture_output=False, text=True)

    if result.returncode != 0:
        print(f"\n{'='*70}")
        print(f"ERROR: {description} failed with exit code {result.returncode}")
        print(f"{'='*70}")
        if not allow_failure:
            sys.exit(1)
        return False

    print(f"\n{'='*70}")
    print(f"SUCCESS: {description} completed")
    print(f"{'='*70}")
    return True


def step_aggregate(config: PipelineConfig) -> bool:
    """Step 1: Aggregate scanner chunks"""
    if config.skip_aggregate:
        print("\n[SKIPPING] Aggregation step")
        return True

    cmd = [
        sys.executable,
        str(config.aggregate_script),
        str(config.scan_root),
        str(config.aggregated_root),
        config.snapshot_date
    ]

    return run_command(cmd, "Aggregate Scanner Chunks")


def step_import(config: PipelineConfig) -> bool:
    """Step 2: Import to backend"""
    if config.skip_import:
        print("\n[SKIPPING] Import step")
        return True

    # Determine source directory
    if config.import_only:
        source_dir = config.scan_root
    else:
        source_dir = config.aggregated_date_dir

    cmd = [
        sys.executable,
        str(config.import_script),
        str(source_dir),
        config.snapshot_date
    ]

    return run_command(cmd, "Import to Backend")


def step_optimize(config: PipelineConfig) -> bool:
    """Step 3: Optimize snapshot"""
    if config.skip_optimize:
        print("\n[SKIPPING] Optimization step")
        return True

    cmd = [
        sys.executable,
        str(config.optimize_script),
        config.snapshot_date
    ]

    return run_command(cmd, "Optimize Snapshot")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description="End-to-end scanner processing pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full pipeline with default settings
  python process_scan_pipeline.py /Volumes/cil/.../cil_scans 2025-12-12

  # Custom aggregated output directory
  python process_scan_pipeline.py \\
    /Volumes/cil/.../cil_scans \\
    2025-12-12 \\
    --aggregated-dir /tmp/cil_scans_aggregated

  # Skip optimization (faster but queries will be slower)
  python process_scan_pipeline.py \\
    /Volumes/cil/.../cil_scans \\
    2025-12-12 \\
    --skip-optimize

  # Import only (aggregation already done)
  python process_scan_pipeline.py \\
    --import-only \\
    /Volumes/cil/.../cil_scans_aggregated/2025-12-12 \\
    2025-12-12
        """
    )

    parser.add_argument(
        'scan_root',
        help='Root directory containing scan subdirectories (or aggregated dir if --import-only)'
    )
    parser.add_argument(
        'snapshot_date',
        help='Snapshot date in YYYY-MM-DD format'
    )
    parser.add_argument(
        '--aggregated-dir',
        help='Custom directory for aggregated outputs (default: {scan_root}_aggregated)'
    )
    parser.add_argument(
        '--skip-aggregate',
        action='store_true',
        help='Skip aggregation step (use if already aggregated)'
    )
    parser.add_argument(
        '--skip-import',
        action='store_true',
        help='Skip import step (use for testing aggregation only)'
    )
    parser.add_argument(
        '--skip-optimize',
        action='store_true',
        help='Skip optimization step (faster but queries will be slower)'
    )
    parser.add_argument(
        '--import-only',
        action='store_true',
        help='Only import (skip aggregation). scan_root should be the aggregated directory.'
    )

    args = parser.parse_args()

    # Create configuration
    config = PipelineConfig(args)

    # Validate
    if not config.validate():
        sys.exit(1)

    # Print summary
    config.print_summary()

    # Confirm with user
    response = input("Proceed with pipeline? (yes/no): ")
    if response.lower() != 'yes':
        print("Pipeline cancelled")
        sys.exit(0)

    # Execute pipeline steps
    start_time = datetime.now()

    success = True
    success = success and step_aggregate(config)
    success = success and step_import(config)
    success = success and step_optimize(config)

    # Final summary
    elapsed = datetime.now() - start_time

    print(f"\n{'='*70}")
    if success:
        print(f"PIPELINE COMPLETED SUCCESSFULLY")
    else:
        print(f"PIPELINE COMPLETED WITH ERRORS")
    print(f"{'='*70}")
    print(f"Snapshot Date:  {config.snapshot_date}")
    print(f"Elapsed Time:   {elapsed}")
    print(f"Backend Ready:  {config.backend_data_root / config.snapshot_date}")
    print(f"\nNext Steps:")
    print(f"  1. Start the backend API server")
    print(f"  2. Navigate to the frontend and select snapshot: {config.snapshot_date}")
    print(f"  3. Explore your scan data!")
    print(f"{'='*70}\n")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
