#!/usr/bin/env python3
"""Main script to generate storage audit and data cleaning reports.

This script analyzes scanner parquet output and generates comprehensive
audit reports for server storage directories.

Usage:
    python generate_report.py <snapshot_parquet> <target_directory> [output_dir]

Example:
    python generate_report.py /scans/snapshot_2025-12-11.parquet /project/cil/gcp ./output
"""

import sys
import logging
from pathlib import Path
from typing import Dict, Any

from data_analyzer import StorageDataAnalyzer
from report_generator import ReportGenerator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)


def generate_audit_report(
    snapshot_path: str,
    target_directory: str = None,
    output_dir: str = "./reports/output"
) -> Path:
    """
    Generate comprehensive audit report for a directory.

    Args:
        snapshot_path: Path to parquet snapshot file
        target_directory: Optional directory to analyze. If None, auto-detects from snapshot.
        output_dir: Output directory for reports

    Returns:
        Path to generated report
    """
    logger.info("=" * 80)
    logger.info("STORAGE AUDIT REPORT GENERATION")
    logger.info("=" * 80)
    logger.info(f"Snapshot: {snapshot_path}")
    if target_directory:
        logger.info(f"Target Directory: {target_directory}")
    else:
        logger.info("Target Directory: Auto-detect from snapshot")
    logger.info(f"Output Directory: {output_dir}")
    logger.info("")

    # Validate inputs
    snapshot_file = Path(snapshot_path)
    if not snapshot_file.exists():
        logger.error(f"Snapshot file not found: {snapshot_path}")
        sys.exit(1)

    logger.info("Step 1: Initializing data analyzer")
    analyzer = StorageDataAnalyzer(snapshot_path, target_directory)

    # Collect all analysis data
    analysis_data: Dict[str, Any] = {}

    logger.info("Step 2: Analyzing main folder")
    analysis_data['main_folder'] = analyzer.get_main_folder_analysis()
    logger.info(f"  Total files: {analysis_data['main_folder']['total_files']:,}")
    logger.info(f"  Total size: {analysis_data['main_folder']['total_size']:,} bytes")

    logger.info("Step 3: Performing hierarchical analysis")
    analysis_data['hierarchical'] = analyzer.get_hierarchical_analysis(max_depth=5)
    logger.info(f"  Analyzed {len(analysis_data['hierarchical'])} levels")

    logger.info("Step 4: Identifying hotspots")
    analysis_data['hotspots'] = analyzer.get_hotspots()
    logger.info(f"  Found {len(analysis_data['hotspots']['heavy_directories'])} heavy directories")
    logger.info(f"  Found {len(analysis_data['hotspots']['largest_files'])} large files")

    logger.info("Step 5: Analyzing file age")
    analysis_data['age_analysis'] = analyzer.get_age_analysis()

    logger.info("Step 6: Identifying cleanup opportunities")
    analysis_data['cleanup_opportunities'] = analyzer.get_cleanup_opportunities()

    logger.info("Step 7: User analysis")
    user_analysis = analyzer.get_user_analysis()
    if user_analysis:
        analysis_data['user_analysis'] = user_analysis
        logger.info(f"  Found {len(user_analysis['user_storage'])} users")
    else:
        logger.info("  Skipped (not a home directory)")

    logger.info("Step 8: Analyzing critically large files")
    analysis_data['large_files'] = analyzer.get_large_files_analysis()

    logger.info("Step 9: Analyzing trash and hidden files")
    analysis_data['trash_hidden'] = analyzer.get_trash_and_hidden_analysis()

    logger.info("Step 10: Classifying file types")
    analysis_data['file_classification'] = analyzer.get_file_type_classification()

    # Close analyzer
    analyzer.close()

    logger.info("")
    logger.info("Step 11: Generating report document")

    # Extract directory name for report
    if target_directory:
        dir_name = target_directory.strip('/').replace('/', '_')
        if not dir_name:
            dir_name = "root"
    else:
        # Use snapshot filename as directory name
        dir_name = Path(snapshot_path).stem

    # Generate report
    generator = ReportGenerator(target_directory or "snapshot_data", analysis_data, output_dir)
    report_path = generator.generate()

    logger.info("")
    logger.info("=" * 80)
    logger.info("REPORT GENERATION COMPLETE")
    logger.info("=" * 80)
    logger.info(f"Report saved to: {report_path}")
    logger.info(f"HTML version: {report_path.with_suffix('.html')}")
    logger.info("")

    return report_path


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python generate_report.py <snapshot_parquet> [target_directory] [output_dir]")
        print()
        print("Arguments:")
        print("  snapshot_parquet   Path to parquet snapshot file")
        print("  target_directory   Optional: Directory to analyze. If omitted, auto-detects from snapshot.")
        print("  output_dir         Output directory for reports (default: ./reports/output)")
        print()
        print("Examples:")
        print("  python generate_report.py /scans/snapshot.parquet")
        print("  python generate_report.py /scans/snapshot.parquet /project/cil/gcp")
        print("  python generate_report.py /scans/snapshot.parquet /project/cil/gcp ./output")
        sys.exit(1)

    snapshot_path = sys.argv[1]
    target_directory = sys.argv[2] if len(sys.argv) > 2 else None
    output_dir = sys.argv[3] if len(sys.argv) > 3 else "./reports/output"

    try:
        report_path = generate_audit_report(snapshot_path, target_directory, output_dir)
        logger.info("Report generation successful")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Report generation failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
