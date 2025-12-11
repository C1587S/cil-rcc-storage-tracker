"""Report generator for storage audit and data cleaning reports.

This module generates professional Markdown/HTML reports from analyzed storage data.
Reports are simple, clear, and actionable for server administrators.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import json

logger = logging.getLogger(__name__)


def format_bytes(size: float) -> str:
    """Format bytes to human-readable string."""
    # Convert to float to handle Decimal and other numeric types
    if size is None:
        return "0.00 B"
    size = float(size)
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"


def format_number(num: int) -> str:
    """Format number with thousand separators."""
    return f"{num:,}"


def format_percentage(value: float, total: float) -> str:
    """Calculate and format percentage."""
    if total == 0 or total is None or value is None:
        return "0.00%"
    # Convert to float to handle Decimal and other numeric types
    value = float(value)
    total = float(total)
    return f"{(value / total * 100):.2f}%"


def format_timestamp(timestamp) -> str:
    """Format timestamp to string date."""
    if timestamp is None:
        return 'Unknown'
    if isinstance(timestamp, str):
        return timestamp[:10] if len(timestamp) >= 10 else timestamp
    if isinstance(timestamp, (int, float)):
        from datetime import datetime
        try:
            return datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d')
        except:
            return str(timestamp)
    return str(timestamp)


class ReportGenerator:
    """Generates comprehensive storage audit reports in Markdown + HTML format."""

    def __init__(self, directory_name: str, analysis_data: Dict[str, Any], output_dir: str):
        """
        Initialize report generator.

        Args:
            directory_name: Name of the directory being analyzed
            analysis_data: Complete analysis data from StorageDataAnalyzer
            output_dir: Directory to save the report
        """
        self.directory_name = directory_name
        self.data = analysis_data
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.report_lines = []
        self.generation_time = datetime.now()

    def generate(self) -> Path:
        """
        Generate complete report.

        Returns:
            Path to generated report file
        """
        logger.info(f"Generating report for {self.directory_name}")

        self._add_header()
        self._add_main_folder_analysis()
        self._add_hierarchical_analysis()
        self._add_hotspots_analysis()
        self._add_age_analysis()
        self._add_cleanup_opportunities()

        if self.data.get('user_analysis'):
            self._add_user_analysis()

        self._add_large_files_analysis()
        self._add_trash_hidden_analysis()
        self._add_file_type_classification()
        self._add_footer()

        # Write report
        report_filename = f"audit_report_{self.directory_name.replace('/', '_')}_{self.generation_time.strftime('%Y%m%d')}.md"
        report_path = self.output_dir / report_filename

        with open(report_path, 'w') as f:
            f.write('\n'.join(self.report_lines))

        logger.info(f"Report generated: {report_path}")

        # Generate HTML version
        html_path = self._generate_html(report_path)

        return report_path

    def _add(self, line: str = ""):
        """Add line to report."""
        self.report_lines.append(line)

    def _add_header(self):
        """Add report header."""
        self._add("# Data Audit and Data Cleaning Report")
        self._add()
        self._add(f"**Directory:** `{self.directory_name}`  ")
        self._add(f"**Generated:** {self.generation_time.strftime('%Y-%m-%d %H:%M:%S')}  ")
        self._add(f"**Report Type:** Storage Audit and Data Analysis")
        self._add()
        self._add("---")
        self._add()

    def _add_executive_summary(self):
        """Add executive summary section."""
        self._add("## Executive Summary")
        self._add()

        main = self.data['main_folder']
        total_size = main['total_size']
        total_files = main['total_files']

        self._add(f"This report provides a comprehensive analysis of storage usage for `{self.directory_name}`. ")
        self._add(f"The directory currently contains **{format_number(total_files)} files** ")
        self._add(f"consuming **{format_bytes(total_size)}** of storage space.")
        self._add()

        # Key findings
        self._add("### Key Findings")
        self._add()

        hotspots = self.data['hotspots']
        if hotspots['heavy_directories']:
            heaviest = hotspots['heavy_directories'][0]
            self._add(f"- **Largest subdirectory:** `{heaviest['directory']}` ({format_bytes(heaviest['total_size'])})")

        if hotspots['largest_files']:
            largest_file = hotspots['largest_files'][0]
            self._add(f"- **Largest single file:** `{largest_file['path']}` ({format_bytes(largest_file['size'])})")

        cleanup = self.data['cleanup_opportunities']
        if cleanup['checkpoints']['checkpoint_count'] > 0:
            self._add(f"- **Checkpoint files:** {format_number(cleanup['checkpoints']['checkpoint_count'])} "
                     f"files using {format_bytes(cleanup['checkpoints']['total_size'])}")

        if cleanup['temporary_files']['temp_file_count'] > 0:
            self._add(f"- **Temporary files:** {format_number(cleanup['temporary_files']['temp_file_count'])} "
                     f"files using {format_bytes(cleanup['temporary_files']['total_size'])}")

        self._add()
        self._add("---")
        self._add()

    def _add_main_folder_analysis(self):
        """Section 1: Analysis of the Main Folder."""
        self._add("## 1. Analysis of the Main Folder")
        self._add()

        main = self.data['main_folder']

        self._add("### Storage Overview")
        self._add()
        self._add(f"- **Total Size:** {format_bytes(main['total_size'])}")
        self._add(f"- **Total Files:** {format_number(main['total_files'])}")
        self._add(f"- **Subdirectories:** {format_number(main['subdirectory_count'])}")
        self._add(f"- **Unique File Types:** {format_number(main['unique_file_types'])}")
        self._add()

        # Predominant file types
        self._add("### Predominant File Types")
        self._add()
        self._add("| File Type | Count | Total Size | Percentage |")
        self._add("|-----------|-------|------------|------------|")

        for file_type in main['predominant_types'][:10]:
            pct = format_percentage(file_type['total_size'], main['total_size'])
            self._add(f"| {file_type['file_type']} | {format_number(file_type['count'])} | "
                     f"{format_bytes(file_type['total_size'])} | {pct} |")

        self._add()

        # Heaviest subdirectory
        if main['heaviest_subdirectory']:
            heaviest = main['heaviest_subdirectory']
            self._add("### Heaviest Subdirectory")
            self._add()
            self._add(f"**Directory:** `{heaviest['directory']}`")
            self._add()
            self._add(f"- **Size:** {format_bytes(heaviest['total_size'])}")
            self._add(f"- **Files:** {format_number(heaviest['file_count'])}")
            self._add(f"- **Percentage of total:** {format_percentage(heaviest['total_size'], main['total_size'])}")
            self._add()

        self._add("---")
        self._add()

    def _add_hierarchical_analysis(self):
        """Section 2: Hierarchical Weight Analysis."""
        self._add("## 2. Hierarchical Weight Analysis")
        self._add()
        self._add("This section shows how storage is distributed across the directory hierarchy, ")
        self._add("identifying the heaviest folders at each level.")
        self._add()

        hierarchical = self.data['hierarchical']

        for level_data in hierarchical[:5]:  # Show first 5 levels
            depth = level_data['depth']
            folders = level_data['folders']

            self._add(f"### Level {depth}")
            self._add()
            self._add("| Folder | File Count | Total Size | Percentage |")
            self._add("|--------|------------|------------|------------|")

            total_at_level = sum(f['total_size'] for f in folders)

            for folder in folders[:15]:  # Top 15 per level
                pct = format_percentage(folder['total_size'], total_at_level)
                self._add(f"| `{folder['folder_name']}` | {format_number(folder['file_count'])} | "
                         f"{format_bytes(folder['total_size'])} | {pct} |")

            self._add()

        self._add("### Structural Observations")
        self._add()

        # Analyze structure
        if len(hierarchical) > 3:
            self._add("- Directory structure has significant depth (>3 levels)")
            deep_folders = [f for level in hierarchical for f in level['folders'] if f.get('depth_level', 0) > 3]
            if deep_folders:
                self._add("- Deep nested structures may impact performance and management")

        self._add()
        self._add("---")
        self._add()

    def _add_hotspots_analysis(self):
        """Section 3: Hotspots (Critical Points)."""
        self._add("## 3. Hotspots (Critical Points)")
        self._add()
        self._add("This section identifies critical storage consumption points that require immediate attention.")
        self._add()

        hotspots = self.data['hotspots']

        # Heaviest directories
        self._add("### Heaviest Subdirectories (Top 20)")
        self._add()
        self._add("| Directory | File Count | Total Size | Largest File |")
        self._add("|-----------|------------|------------|--------------|")

        for dir_info in hotspots['heavy_directories'][:20]:
            self._add(f"| `{dir_info['directory']}` | {format_number(dir_info['file_count'])} | "
                     f"{format_bytes(dir_info['total_size'])} | {format_bytes(dir_info['largest_file'])} |")

        self._add()

        # Largest files
        self._add("### Largest Individual Files (Top 30)")
        self._add()
        self._add("| File Path | Size | Type | Last Modified |")
        self._add("|-----------|------|------|---------------|")

        for file_info in hotspots['largest_files'][:30]:
            mod_time = format_timestamp(file_info['modified_time'])
            self._add(f"| `{file_info['path']}` | {format_bytes(file_info['size'])} | "
                     f"{file_info['file_type'] or 'N/A'} | {mod_time} |")

        self._add()

        # Size threshold analysis
        self._add("### Files by Size Threshold")
        self._add()

        threshold_analysis = hotspots['size_threshold_analysis']

        for threshold_name, data in threshold_analysis.items():
            self._add(f"**{threshold_name.replace('_', ' ').title()}:**")
            self._add()
            self._add(f"- Count: {format_number(data['count'])}")
            self._add(f"- Total Size: {format_bytes(data['total_size'])}")
            self._add()

        # File types consuming most space
        self._add("### File Types Consuming Most Space")
        self._add()
        self._add("| File Type | File Count | Total Size | Average Size | Max Size |")
        self._add("|-----------|------------|------------|--------------|----------|")

        for type_info in hotspots['type_consumption'][:15]:
            self._add(f"| {type_info['file_type']} | {format_number(type_info['file_count'])} | "
                     f"{format_bytes(type_info['total_size'])} | {format_bytes(type_info['avg_size'])} | "
                     f"{format_bytes(type_info['max_size'])} |")

        self._add()
        self._add("---")
        self._add()

    def _add_age_analysis(self):
        """Section 4: Age (Temporal) Analysis."""
        self._add("## 4. Age (Temporal) Analysis")
        self._add()
        self._add("Analysis of files based on last modification time, identifying old or unused data.")
        self._add()

        age = self.data['age_analysis']

        # Age buckets
        self._add("### Files by Age")
        self._add()
        self._add("| Age Range | File Count | Total Size |")
        self._add("|-----------|------------|------------|")

        total_size = sum(bucket['total_size'] or 0 for bucket in age['age_buckets'])

        for bucket in age['age_buckets']:
            bucket_size = bucket['total_size'] or 0
            pct = format_percentage(bucket_size, total_size) if total_size > 0 else "0%"
            self._add(f"| {bucket['age_bucket']} | {format_number(bucket['file_count'])} | "
                     f"{format_bytes(bucket_size)} ({pct}) |")

        self._add()

        # Old files by type
        self._add("### Old Files (>1 year) by Type")
        self._add()
        self._add("| File Type | File Count | Total Size |")
        self._add("|-----------|------------|------------|")

        for type_info in age['old_files_by_type'][:15]:
            self._add(f"| {type_info['file_type']} | {format_number(type_info['file_count'])} | "
                     f"{format_bytes(type_info['total_size'])} |")

        self._add()

        # Directories with old content
        self._add("### Directories with High Amounts of Old Content")
        self._add()
        self._add("| Directory | Old Files | Total Size | Most Recent Modification |")
        self._add("|-----------|-----------|------------|--------------------------|")

        for dir_info in age['directories_with_old_content'][:15]:
            recent = format_timestamp(dir_info['most_recent_modification'])
            self._add(f"| `{dir_info['directory']}` | {format_number(dir_info['old_file_count'])} | "
                     f"{format_bytes(dir_info['total_size'])} | {recent} |")

        self._add()
        self._add("---")
        self._add()

    def _add_cleanup_opportunities(self):
        """Section 5: Cleanup / Reduction Opportunities."""
        self._add("## 5. Cleanup and Reduction Opportunities")
        self._add()
        self._add("This section identifies potential cleanup and reduction opportunities.")
        self._add()

        cleanup = self.data['cleanup_opportunities']

        # Potential duplicates
        self._add("### Potential Duplicate Files")
        self._add()

        duplicates = cleanup['potential_duplicates']
        if duplicates:
            total_wasted = sum(d['total_wasted'] for d in duplicates)
            self._add(f"**Total potential space wasted by duplicates:** {format_bytes(total_wasted)}")
            self._add()
            self._add("| Filename | Size | Occurrences | Wasted Space |")
            self._add("|----------|------|-------------|--------------|")

            for dup in duplicates[:20]:
                self._add(f"| {dup['filename']} | {format_bytes(dup['size'])} | "
                         f"{format_number(dup['occurrence_count'])} | {format_bytes(dup['total_wasted'])} |")
            self._add()
        else:
            self._add("No significant duplicate files detected (based on name and size matching).")
            self._add()

        # Checkpoints
        self._add("### Checkpoint Files")
        self._add()

        ckpt = cleanup['checkpoints']
        if ckpt['checkpoint_count'] > 0:
            self._add(f"**Total checkpoint files:** {format_number(ckpt['checkpoint_count'])}  ")
            self._add(f"**Total size:** {format_bytes(ckpt['total_size'])}")
            self._add()
        else:
            self._add("No checkpoint files detected.")
            self._add()

        # Temporary files
        self._add("### Temporary and Intermediate Files")
        self._add()

        temp = cleanup['temporary_files']
        if temp['temp_file_count'] > 0:
            self._add(f"**Total temporary files:** {format_number(temp['temp_file_count'])}  ")
            self._add(f"**Total size:** {format_bytes(temp['total_size'])}")
            self._add()
        else:
            self._add("No temporary files detected.")
            self._add()

        # Compressible files
        self._add("### Compression Opportunities")
        self._add()

        compressible = cleanup['compressible_files']
        if compressible:
            total_savings = sum(c['estimated_savings'] for c in compressible)
            self._add(f"**Estimated space savings through compression:** {format_bytes(total_savings)}")
            self._add()
            self._add("| File Type | File Count | Current Size | Estimated Savings |")
            self._add("|-----------|------------|--------------|-------------------|")

            for comp in compressible:
                self._add(f"| {comp['file_type']} | {format_number(comp['file_count'])} | "
                         f"{format_bytes(comp['total_size'])} | {format_bytes(comp['estimated_savings'])} |")

            self._add()
        else:
            self._add("No significant compression opportunities identified.")
            self._add()

        # Priority recommendations
        self._add("### Priority Cleanup Actions")
        self._add()
        self._add("**High Priority:**")
        self._add()

        if temp['temp_file_count'] > 0:
            self._add(f"1. Delete temporary files: {format_bytes(temp['total_size'])} recoverable")

        if ckpt['checkpoint_count'] > 10:
            self._add(f"2. Review and clean checkpoint files: potentially {format_bytes(ckpt['total_size'] * 0.5)} "
                     f"recoverable by removing old checkpoints")

        self._add()
        self._add("**Medium Priority:**")
        self._add()

        if compressible:
            self._add(f"1. Compress eligible files: {format_bytes(total_savings)} estimated savings")

        if duplicates:
            self._add(f"2. Investigate and remove duplicate files: {format_bytes(total_wasted)} potential savings")

        self._add()
        self._add("**Low Priority:**")
        self._add()
        self._add("1. Archive old data (>1 year) to cheaper storage tiers")
        self._add("2. Review rarely accessed files for archival or deletion")
        self._add()
        self._add("---")
        self._add()

    def _add_user_analysis(self):
        """Section 6: User / Homedir Analysis."""
        self._add("## 6. User and Home Directory Analysis")
        self._add()

        user = self.data['user_analysis']

        # User storage
        self._add("### Storage Usage by User")
        self._add()
        self._add("| Username | File Count | Total Size | Last Access |")
        self._add("|----------|------------|------------|-------------|")

        for user_info in user['user_storage'][:30]:
            last_access = format_timestamp(user_info['last_access'])
            self._add(f"| {user_info['username']} | {format_number(user_info['file_count'])} | "
                     f"{format_bytes(user_info['total_size'])} | {last_access} |")

        self._add()

        # Inactive users
        self._add("### Inactive Users (>6 months since last access)")
        self._add()

        if user['inactive_users']:
            self._add("| Username | Total Size | Last Access |")
            self._add("|----------|------------|-------------|")

            for inactive in user['inactive_users']:
                last_access = format_timestamp(inactive['last_access'])
                self._add(f"| {inactive['username']} | {format_bytes(inactive['total_size'])} | {last_access} |")

            self._add()
        else:
            self._add("No inactive users detected.")

        self._add()
        self._add("---")
        self._add()

    def _add_large_files_analysis(self):
        """Section 7: Analysis of Critically Large Files."""
        self._add("## 7. Analysis of Critically Large Files")
        self._add()
        self._add("Files larger than 10GB require special attention due to their significant storage impact.")
        self._add()

        large_files = self.data['large_files']

        for threshold in ['10GB', '50GB', '100GB']:
            files = large_files.get(threshold, [])

            if files:
                self._add(f"### Files Larger Than {threshold}")
                self._add()
                self._add(f"**Count:** {format_number(len(files))}  ")
                total = sum(f['size'] for f in files)
                self._add(f"**Total Size:** {format_bytes(total)}")
                self._add()
                self._add("| File Path | Size | Type | Modified |")
                self._add("|-----------|------|------|----------|")

                for file_info in files[:20]:
                    mod_time = format_timestamp(file_info['modified_time'])
                    self._add(f"| `{file_info['path']}` | {format_bytes(file_info['size'])} | "
                             f"{file_info['file_type'] or 'N/A'} | {mod_time} |")

                self._add()

        self._add("---")
        self._add()

    def _add_trash_hidden_analysis(self):
        """Section 8: Trash, Hidden, and Residual Files Analysis."""
        self._add("## 8. Trash, Hidden, and Residual Files Analysis")
        self._add()

        trash = self.data['trash_hidden']

        # Hidden files
        self._add("### Hidden Files (starting with .)")
        self._add()
        hidden = trash['hidden_files']
        self._add(f"- **Count:** {format_number(hidden['hidden_file_count'])}")
        self._add(f"- **Total Size:** {format_bytes(hidden['total_size'])}")
        self._add()

        # Cache files
        self._add("### Cache and Application Directories")
        self._add()
        cache = trash['cache_files']
        if cache['cache_file_count'] > 0:
            self._add(f"- **Count:** {format_number(cache['cache_file_count'])}")
            self._add(f"- **Total Size:** {format_bytes(cache['total_size'])}")
            self._add()
            self._add("Includes: `.cache/`, `__pycache__/`, `.ipynb_checkpoints/`, `node_modules/`")
            self._add()
        else:
            self._add("No significant cache directories detected.")
        self._add()

        # Empty files
        self._add("### Empty Files (0 bytes)")
        self._add()
        empty = trash['empty_files']
        if empty['empty_file_count'] > 0:
            self._add(f"- **Count:** {format_number(empty['empty_file_count'])}")
            self._add()
        else:
            self._add("No empty files detected.")
        self._add()

        # Trash folders
        self._add("### Trash Folders")
        self._add()
        trash_files = trash['trash_files']
        if trash_files['trash_file_count'] > 0:
            self._add(f"- **Count:** {format_number(trash_files['trash_file_count'])}")
            self._add(f"- **Total Size:** {format_bytes(trash_files['total_size'])}")
            self._add()
        else:
            self._add("No files in trash folders detected.")
        self._add()

        self._add("---")
        self._add()

    def _add_file_type_classification(self):
        """Section 11: File Type Classification."""
        self._add("## 11. File Type Classification")
        self._add()
        self._add("Breakdown of storage usage by data category.")
        self._add()

        classification = self.data['file_classification']

        if classification:
            total_classified = sum(c['total_size'] for c in classification)

            self._add("| Category | File Count | Total Size | Avg Size | Max Size | Percentage |")
            self._add("|----------|------------|------------|----------|----------|------------|")

            for category in classification:
                pct = format_percentage(category['total_size'], total_classified)
                self._add(f"| {category['category'].title()} | {format_number(category['file_count'])} | "
                         f"{format_bytes(category['total_size'])} | {format_bytes(category['avg_size'])} | "
                         f"{format_bytes(category['max_size'])} | {pct} |")

            self._add()

            # Analysis
            self._add("### Category Analysis")
            self._add()

            for category in sorted(classification, key=lambda x: x['total_size'], reverse=True)[:3]:
                cat_name = category['category'].title()
                self._add(f"**{cat_name}:** {format_bytes(category['total_size'])} "
                         f"({format_percentage(category['total_size'], total_classified)} of classified data)")

                if category['category'] == 'logs':
                    self._add("  - Consider implementing log rotation or archival policies")
                elif category['category'] == 'checkpoints':
                    self._add("  - Review and remove outdated model checkpoints")
                elif category['category'] == 'temporary':
                    self._add("  - Temporary files should be reviewed and cleaned regularly")
                elif category['category'] == 'datasets':
                    self._add("  - Verify all datasets are actively used; archive completed experiments")

                self._add()

        else:
            self._add("No file type classification available.")
            self._add()

        self._add("---")
        self._add()

    def _add_recommendations(self):
        """Add overall recommendations section."""
        self._add("## Summary and Recommendations")
        self._add()

        self._add("### Immediate Actions (High Impact)")
        self._add()
        self._add("1. **Remove temporary files** to reclaim space quickly and safely")
        self._add("2. **Empty trash folders** permanently")
        self._add("3. **Delete cache directories** (applications will regenerate as needed)")
        self._add("4. **Review and remove old checkpoints** keeping only necessary model versions")
        self._add()

        self._add("### Short-term Actions (Medium Impact)")
        self._add()
        self._add("1. **Compress eligible files** (logs, text files, CSVs) to reduce storage footprint")
        self._add("2. **Investigate duplicate files** and remove unnecessary copies")
        self._add("3. **Contact inactive users** to archive or delete their data")
        self._add("4. **Review large files** (>10GB) for archival or deletion")
        self._add()

        self._add("### Long-term Actions (Preventive)")
        self._add()
        self._add("1. **Implement automated cleanup policies** for temporary and log files")
        self._add("2. **Set up storage quotas** per user or project to prevent unchecked growth")
        self._add("3. **Establish data archival procedures** for completed projects")
        self._add("4. **Regular storage audits** (monthly or quarterly) to identify issues early")
        self._add("5. **Educate users** on storage best practices and cleanup procedures")
        self._add()

        self._add("### Risk Assessment")
        self._add()

        main = self.data['main_folder']
        total_size = main['total_size']

        # Calculate potential recovery
        cleanup = self.data['cleanup_opportunities']
        trash = self.data['trash_hidden']

        potential_recovery = 0
        potential_recovery += float(cleanup['temporary_files']['total_size'] or 0)
        potential_recovery += float(cleanup['checkpoints']['total_size'] or 0) * 0.5  # Assume 50% can be cleaned
        potential_recovery += float(trash['cache_files']['total_size'] or 0)
        potential_recovery += float(trash['trash_files']['total_size'] or 0)

        if cleanup['compressible_files']:
            potential_recovery += sum(float(c['estimated_savings'] or 0) for c in cleanup['compressible_files'])

        self._add(f"**Current Usage:** {format_bytes(total_size)}")
        self._add(f"**Potential Recovery:** {format_bytes(potential_recovery)} "
                 f"({format_percentage(potential_recovery, total_size)} of total)")
        self._add()

        recovery_ratio = potential_recovery / float(total_size) if total_size > 0 else 0

        if recovery_ratio > 0.3:
            self._add("**Risk Level:** HIGH - Significant storage can be recovered through cleanup")
        elif recovery_ratio > 0.15:
            self._add("**Risk Level:** MEDIUM - Moderate cleanup opportunities available")
        else:
            self._add("**Risk Level:** LOW - Storage is relatively well-managed")

        self._add()
        self._add("---")
        self._add()

    def _add_footer(self):
        """Add report footer."""
        self._add("## Report Information")
        self._add()
        self._add(f"- **Generated by:** Storage Analytics Scanner")
        self._add(f"- **Report Date:** {self.generation_time.strftime('%Y-%m-%d %H:%M:%S')}")
        self._add(f"- **Directory Analyzed:** `{self.directory_name}`")
        self._add()
        self._add("---")
        self._add()
        self._add("*This report was automatically generated from snapshot data.*")

    def _generate_html(self, markdown_path: Path) -> Path:
        """
        Generate HTML version of the report.

        Args:
            markdown_path: Path to markdown file

        Returns:
            Path to HTML file
        """
        try:
            import markdown

            with open(markdown_path, 'r') as f:
                md_content = f.read()

            html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

            # Add CSS styling
            html_full = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Storage Audit Report - {self.directory_name}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        h1, h2, h3 {{ color: #333; }}
        h1 {{ border-bottom: 3px solid #0066cc; padding-bottom: 10px; }}
        h2 {{ border-bottom: 2px solid #0099ff; padding-bottom: 8px; margin-top: 30px; }}
        h3 {{ color: #0066cc; margin-top: 20px; }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background-color: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        th {{
            background-color: #0066cc;
            color: white;
            padding: 12px;
            text-align: left;
        }}
        td {{
            padding: 10px;
            border-bottom: 1px solid #ddd;
        }}
        tr:hover {{ background-color: #f0f0f0; }}
        code {{
            background-color: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: "Courier New", monospace;
        }}
        pre {{
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
        }}
        ul {{ padding-left: 20px; }}
        li {{ margin: 8px 0; }}
        hr {{
            border: none;
            border-top: 1px solid #ddd;
            margin: 30px 0;
        }}
        .content {{
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
    </style>
</head>
<body>
    <div class="content">
        {html_content}
    </div>
</body>
</html>
"""

            html_path = markdown_path.with_suffix('.html')
            with open(html_path, 'w') as f:
                f.write(html_full)

            logger.info(f"HTML report generated: {html_path}")
            return html_path

        except ImportError:
            logger.warning("markdown package not available, skipping HTML generation")
            return markdown_path
        except Exception as e:
            logger.error(f"Error generating HTML: {e}")
            return markdown_path
