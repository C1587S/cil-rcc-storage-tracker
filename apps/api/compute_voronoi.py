#!/usr/bin/env python3
"""
CLI tool to compute voronoi artifacts for snapshots.

Usage:
    python compute_voronoi.py <snapshot_date> [--path PATH] [--depth DEPTH]
    python compute_voronoi.py --all [--depth DEPTH]

Examples:
    # Compute for specific snapshot
    python compute_voronoi.py 2025-12-12

    # Compute with custom root path
    python compute_voronoi.py 2025-12-12 --path /project/cil

    # Compute for all available snapshots
    python compute_voronoi.py --all

    # Compute with custom preview depth
    python compute_voronoi.py 2025-12-12 --depth 3
"""

import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from app.services.voronoi_computer import VoronoiComputer
from app.services.snapshot_storage import SnapshotStorage
from app.db import execute_query

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def fetch_available_snapshots() -> list[dict]:
    """Fetch available snapshots from database."""
    query = """
    SELECT DISTINCT snapshot_date
    FROM filesystem.filesystem_entries
    ORDER BY snapshot_date DESC
    """
    try:
        results = execute_query(query, {})
        return [{"snapshot_date": row["snapshot_date"]} for row in results]
    except Exception as e:
        logger.error(f"Failed to fetch snapshots: {e}")
        return []


def compute_voronoi_for_snapshot(
    snapshot_date: date,
    root_path: str = "/project/cil",
    preview_depth: int = 2,
    force: bool = False,
) -> bool:
    """
    Compute voronoi artifact for a single snapshot.

    Args:
        snapshot_date: Snapshot date to compute
        root_path: Root path to start from
        preview_depth: Preview depth for hierarchy
        force: Force recomputation even if artifact exists

    Returns:
        True if successful, False otherwise
    """
    storage = SnapshotStorage()

    # Check if artifact already exists
    if storage.artifact_exists(snapshot_date) and not force:
        logger.info(f"Artifact already exists for {snapshot_date}, skipping (use --force to recompute)")
        return True

    logger.info(f"Computing voronoi for snapshot {snapshot_date} at path {root_path}")
    start_time = datetime.now()

    try:
        # Create computer and compute
        computer = VoronoiComputer(snapshot_date=snapshot_date, root_path=root_path)
        artifact = computer.compute(preview_depth=preview_depth)

        # Save artifact
        artifact_path = storage.save_voronoi_artifact(snapshot_date, artifact)

        # Also save metadata
        metadata = {
            "snapshot_date": snapshot_date.isoformat(),
            "root_path": root_path,
            "computed_at": artifact.computed_at,
            "version": artifact.version,
            "total_nodes": artifact.hierarchy["metadata"]["total_nodes"],
            "total_size": artifact.snapshot["size"],
            "total_files": artifact.snapshot["file_count"],
        }
        storage.save_metadata(snapshot_date, metadata)

        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(
            f"Successfully computed voronoi for {snapshot_date} in {elapsed:.2f}s\n"
            f"  Nodes: {artifact.hierarchy['metadata']['total_nodes']}\n"
            f"  Size: {artifact.snapshot['size']:,} bytes\n"
            f"  Files: {artifact.snapshot['file_count']:,}\n"
            f"  Saved to: {artifact_path}"
        )
        return True

    except Exception as e:
        logger.error(f"Failed to compute voronoi for {snapshot_date}: {e}", exc_info=True)
        return False


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Compute voronoi artifacts for snapshots",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "snapshot_date",
        nargs="?",
        help="Snapshot date in YYYY-MM-DD format",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Compute for all available snapshots",
    )
    parser.add_argument(
        "--path",
        default="/project/cil",
        help="Root path to compute from (default: /project/cil)",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=2,
        help="Preview depth for hierarchy (default: 2)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force recomputation even if artifact exists",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate arguments
    if not args.all and not args.snapshot_date:
        parser.error("Either provide a snapshot_date or use --all")

    if args.all and args.snapshot_date:
        parser.error("Cannot use both snapshot_date and --all")

    # Get list of snapshots to process
    snapshots_to_process = []

    if args.all:
        logger.info("Fetching available snapshots...")
        available_snapshots = fetch_available_snapshots()
        if not available_snapshots:
            logger.error("No snapshots found")
            return 1
        snapshots_to_process = [
            date.fromisoformat(s["snapshot_date"])
            for s in available_snapshots
        ]
        logger.info(f"Found {len(snapshots_to_process)} snapshots to process")
    else:
        try:
            snapshot_date = date.fromisoformat(args.snapshot_date)
            snapshots_to_process = [snapshot_date]
        except ValueError:
            logger.error(f"Invalid date format: {args.snapshot_date}")
            return 1

    # Process snapshots
    success_count = 0
    fail_count = 0

    for snapshot_date in snapshots_to_process:
        success = compute_voronoi_for_snapshot(
            snapshot_date=snapshot_date,
            root_path=args.path,
            preview_depth=args.depth,
            force=args.force,
        )
        if success:
            success_count += 1
        else:
            fail_count += 1

    # Summary
    logger.info(f"\n{'='*60}")
    logger.info(f"Computation complete!")
    logger.info(f"  Success: {success_count}")
    logger.info(f"  Failed: {fail_count}")
    logger.info(f"{'='*60}")

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
