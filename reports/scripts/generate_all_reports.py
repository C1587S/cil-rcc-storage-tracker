#!/usr/bin/env python3
"""Batch script to generate audit reports for all target directories.

This script generates comprehensive audit reports for all specified server
directories in a single run, suitable for automated scheduling.

Usage:
    python generate_all_reports.py <snapshot_parquet> [output_dir]

Example:
    python generate_all_reports.py /scans/snapshot_2025-12-11.parquet ./reports/output
"""

import sys
import logging
from pathlib import Path
from datetime import datetime
from typing import List

from generate_report import generate_audit_report

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

logger = logging.getLogger(__name__)

# Target directories to analyze
TARGET_DIRECTORIES = [
    "/project/cil/battuta-shares-S3-archive",
    "/project/cil/battuta_shares",
    "/project/cil/gcp",
    "/project/cil/home_dirs",
    "/project/cil/kupe_shares",
    "/project/cil/norgay",
    "/project/cil/sacagawea_shares"
]


def generate_all_reports(
    snapshot_path: str,
    output_dir: str = "./reports/output",
    directories: List[str] = None
) -> List[Path]:
    """
    Generate audit reports for all target directories.

    Args:
        snapshot_path: Path to parquet snapshot file
        output_dir: Output directory for reports
        directories: List of directories to analyze (default: TARGET_DIRECTORIES)

    Returns:
        List of paths to generated reports
    """
    if directories is None:
        directories = TARGET_DIRECTORIES

    start_time = datetime.now()
    generated_reports = []
    failed_reports = []

    logger.info("=" * 80)
    logger.info("BATCH REPORT GENERATION")
    logger.info("=" * 80)
    logger.info(f"Snapshot: {snapshot_path}")
    logger.info(f"Output Directory: {output_dir}")
    logger.info(f"Directories to analyze: {len(directories)}")
    logger.info("")

    for i, directory in enumerate(directories, 1):
        logger.info(f"[{i}/{len(directories)}] Processing: {directory}")
        logger.info("-" * 80)

        try:
            report_path = generate_audit_report(snapshot_path, directory, output_dir)
            generated_reports.append(report_path)
            logger.info(f"SUCCESS: Report generated for {directory}")
        except Exception as e:
            logger.error(f"FAILED: Could not generate report for {directory}: {e}")
            failed_reports.append((directory, str(e)))

        logger.info("")

    # Generate summary
    end_time = datetime.now()
    duration = end_time - start_time

    logger.info("=" * 80)
    logger.info("BATCH GENERATION SUMMARY")
    logger.info("=" * 80)
    logger.info(f"Total directories: {len(directories)}")
    logger.info(f"Successful reports: {len(generated_reports)}")
    logger.info(f"Failed reports: {len(failed_reports)}")
    logger.info(f"Duration: {duration}")
    logger.info("")

    if generated_reports:
        logger.info("Generated Reports:")
        for report in generated_reports:
            logger.info(f"  - {report}")
        logger.info("")

    if failed_reports:
        logger.warning("Failed Reports:")
        for directory, error in failed_reports:
            logger.warning(f"  - {directory}: {error}")
        logger.info("")

    # Create index file
    _create_index_file(generated_reports, output_dir, snapshot_path)

    return generated_reports


def _create_index_file(reports: List[Path], output_dir: str, snapshot_path: str):
    """
    Create an index HTML file linking to all generated reports.

    Args:
        reports: List of report file paths
        output_dir: Output directory
        snapshot_path: Original snapshot path
    """
    try:
        output_path = Path(output_dir)
        index_path = output_path / "index.html"

        generation_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Storage Audit Reports Index</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        h1 {{ color: #333; border-bottom: 3px solid #0066cc; padding-bottom: 10px; }}
        .info {{ background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; }}
        .reports {{ background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
        .report-item {{
            padding: 15px;
            margin: 10px 0;
            border-left: 4px solid #0066cc;
            background-color: #f9f9f9;
        }}
        .report-item:hover {{ background-color: #f0f0f0; }}
        a {{ color: #0066cc; text-decoration: none; font-weight: 500; }}
        a:hover {{ text-decoration: underline; }}
        .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; }}
    </style>
</head>
<body>
    <h1>Storage Audit Reports Index</h1>

    <div class="info">
        <strong>Snapshot:</strong> <code>{snapshot_path}</code><br>
        <strong>Generated:</strong> {generation_time}<br>
        <strong>Total Reports:</strong> {len(reports)}
    </div>

    <div class="reports">
        <h2>Available Reports</h2>
"""

        for report in sorted(reports):
            report_name = report.stem
            html_report = report.with_suffix('.html')
            md_report = report

            html_content += f"""
        <div class="report-item">
            <strong>{report_name.replace('_', ' ').replace('audit report ', '')}</strong><br>
            <a href="{html_report.name}">View HTML Report</a> |
            <a href="{md_report.name}">Download Markdown</a>
        </div>
"""

        html_content += """
    </div>

    <div class="footer">
        <em>All reports generated automatically from scanner snapshot data.</em>
    </div>
</body>
</html>
"""

        with open(index_path, 'w') as f:
            f.write(html_content)

        logger.info(f"Index file created: {index_path}")

    except Exception as e:
        logger.error(f"Could not create index file: {e}")


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python generate_all_reports.py <snapshot_parquet> [output_dir]")
        print()
        print("Arguments:")
        print("  snapshot_parquet   Path to parquet snapshot file")
        print("  output_dir         Output directory for reports (default: ./reports/output)")
        print()
        print("Target Directories:")
        for directory in TARGET_DIRECTORIES:
            print(f"  - {directory}")
        print()
        print("Example:")
        print("  python generate_all_reports.py /scans/snapshot_2025-12-11.parquet")
        sys.exit(1)

    snapshot_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "./reports/output"

    # Validate snapshot exists
    if not Path(snapshot_path).exists():
        logger.error(f"Snapshot file not found: {snapshot_path}")
        sys.exit(1)

    try:
        reports = generate_all_reports(snapshot_path, output_dir)

        if reports:
            logger.info("Batch report generation completed successfully")
            sys.exit(0)
        else:
            logger.error("No reports were generated successfully")
            sys.exit(1)

    except Exception as e:
        logger.error(f"Batch generation failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
