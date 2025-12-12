#!/usr/bin/env python3
"""Improved storage audit report generator following REPORT_REQUIREMENTS.md.

This script generates reports with:
- Simple, clear language
- Executive summary with actionable insights
- Top 10 folders (not hierarchical depth)
- Activity-based analysis
- Storage efficiency review

Usage:
    python generate_report_v2.py <snapshot_parquet> <target_directory> [output_dir]

Example:
    python generate_report_v2.py /scans/snapshot.parquet /project/cil/gcp ./output
"""

import sys
import logging
import time
from pathlib import Path
from typing import Dict, Any

from data_analyzer import StorageDataAnalyzer
from report_generator import ImprovedReportGenerator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)


def generate_improved_report(
    snapshot_path: str,
    target_directory: str = None,
    output_dir: str = "./reports/output"
) -> Path:
    """
    Generate improved storage audit report.

    Args:
        snapshot_path: Path to parquet snapshot file
        target_directory: Optional directory to analyze
        output_dir: Output directory for reports

    Returns:
        Path to generated report
    """
    # Track compute time
    start_time = time.time()

    logger.info("=" * 80)
    logger.info("IMPROVED STORAGE AUDIT REPORT GENERATION")
    logger.info("=" * 80)
    logger.info(f"Snapshot: {snapshot_path}")
    if target_directory:
        logger.info(f"Target Directory: {target_directory}")
    else:
        logger.info("Target Directory: Analyzing entire snapshot")
    logger.info(f"Output Directory: {output_dir}")
    logger.info("")

    # Validate snapshot path
    # Support glob patterns
    if '*' in snapshot_path:
        import glob
        matching_files = glob.glob(snapshot_path)
        if not matching_files:
            logger.error(f"No files found matching pattern: {snapshot_path}")
            sys.exit(1)
        logger.info(f"Found {len(matching_files)} files matching pattern")
    else:
        snapshot_file = Path(snapshot_path)
        if not snapshot_file.exists():
            logger.error(f"Snapshot file not found: {snapshot_path}")
            sys.exit(1)

    logger.info("Step 1: Initializing data analyzer")
    analyzer = StorageDataAnalyzer(snapshot_path, target_directory)

    # Collect analysis data
    analysis_data: Dict[str, Any] = {}

    # Get snapshot metadata first
    logger.info("Step 2: Getting snapshot metadata")
    snapshot_metadata = analyzer.get_snapshot_metadata()
    analysis_data['snapshot_metadata'] = snapshot_metadata
    logger.info(f"  Snapshot date: {snapshot_metadata['snapshot_file_date']}")

    logger.info("Step 3: Analyzing main folder")
    analysis_data['main_folder'] = analyzer.get_main_folder_analysis()
    logger.info(f"  Total files: {analysis_data['main_folder']['total_files']:,}")
    logger.info(f"  Total size: {analysis_data['main_folder']['total_size']:,} bytes")

    # NEW: Top 10 folders (replaces hierarchical analysis)
    logger.info("Step 4: Identifying top 10 folders")
    analysis_data['top_folders'] = analyzer.get_top_n_folders(n=10)
    logger.info(f"  Found top 10 folders")

    logger.info("Step 5: Identifying hotspots")
    analysis_data['hotspots'] = analyzer.get_hotspots()
    logger.info(f"  Found {len(analysis_data['hotspots']['heavy_directories'])} heavy directories")

    # NEW: Folder activity analysis
    logger.info("Step 6: Analyzing folder activity")
    analysis_data['folder_activity'] = analyzer.get_folder_activity_analysis()
    active_old = analysis_data['folder_activity']['active_old_folders']
    cold = analysis_data['folder_activity']['cold_folders']
    logger.info(f"  Active old folders: {len(active_old)}")
    logger.info(f"  Cold folders: {len(cold)}")

    logger.info("Step 7: Analyzing file age")
    analysis_data['age_analysis'] = analyzer.get_age_analysis()

    logger.info("Step 8: Identifying cleanup opportunities")
    analysis_data['cleanup_opportunities'] = analyzer.get_cleanup_opportunities()

    logger.info("Step 9: User analysis")
    user_analysis = analyzer.get_user_analysis()
    if user_analysis:
        analysis_data['user_analysis'] = user_analysis
        logger.info(f"  Found {len(user_analysis['user_storage'])} users")
    else:
        logger.info("  Skipped (not a home directory)")

    logger.info("Step 10: Analyzing critically large files")
    analysis_data['large_files'] = analyzer.get_large_files_analysis()

    logger.info("Step 11: Analyzing trash and hidden files")
    analysis_data['trash_hidden'] = analyzer.get_trash_and_hidden_analysis()

    logger.info("Step 12: Classifying file types")
    analysis_data['file_classification'] = analyzer.get_file_type_classification()

    logger.info("Step 13: Analyzing file type locations")
    analysis_data['file_type_locations'] = analyzer.get_file_type_locations()

    logger.info("Step 14: Getting file size distribution")
    analysis_data['file_size_distribution'] = analyzer.get_file_size_distribution(sample_size=10000)

    # Close analyzer
    analyzer.close()

    logger.info("")
    logger.info("Step 14: Generating improved report document")

    # Extract directory name for report
    if target_directory:
        dir_name = target_directory.strip('/').replace('/', '_')
        if not dir_name:
            dir_name = "root"
    else:
        dir_name = Path(snapshot_path).stem

    # Generate improved report
    generator = ImprovedReportGenerator(
        directory_name=target_directory or "snapshot_data",
        analysis_data=analysis_data,
        output_dir=output_dir,
        snapshot_date=snapshot_metadata['snapshot_file_date'],
        compute_start_time=start_time
    )

    report_path = generator.generate()

    logger.info("")
    logger.info("=" * 80)
    logger.info("REPORT GENERATION COMPLETE")
    logger.info("=" * 80)
    logger.info(f"Report saved to: {report_path}")
    logger.info(f"HTML version: {report_path.with_suffix('.html')}")

    # Calculate total time
    total_time = time.time() - start_time
    logger.info(f"Total compute time: {total_time:.2f} seconds")
    logger.info("")

    return report_path


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python generate_report_v2.py <snapshot_parquet> [target_directory] [output_dir]")
        print()
        print("Arguments:")
        print("  snapshot_parquet   Path to parquet snapshot file")
        print("  target_directory   Optional: Directory to analyze")
        print("  output_dir         Output directory (default: ./reports/output)")
        print()
        print("Examples:")
        print("  python generate_report_v2.py /scans/snapshot.parquet")
        print("  python generate_report_v2.py /scans/snapshot.parquet /project/cil/gcp")
        print("  python generate_report_v2.py /scans/snapshot.parquet /project/cil/gcp ./output")
        sys.exit(1)

    snapshot_path = sys.argv[1]
    # Handle empty string as None for target_directory
    target_directory = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    output_dir = sys.argv[3] if len(sys.argv) > 3 else "./reports/output"

    try:
        report_path = generate_improved_report(snapshot_path, target_directory, output_dir)
        logger.info("Report generation successful")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Report generation failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
