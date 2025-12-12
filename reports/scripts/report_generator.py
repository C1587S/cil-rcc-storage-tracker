"""Improved report generator following REPORT_REQUIREMENTS.md guidelines.

This module generates storage audit reports with:
- Simple, clear language
- Executive summary with actionable insights
- Top 10 folders analysis (not hierarchical depth)
- Storage efficiency and hygiene review
- Activity-based analysis
- Styled tables using pandas Styler
- Professional visualizations
"""

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
import time

logger = logging.getLogger(__name__)


def format_bytes(size: float) -> str:
    """Format bytes to human-readable string."""
    if size is None:
        return "0 B"
    size = float(size)
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"


def format_number(num: int) -> str:
    """Format number with thousand separators."""
    return f"{num:,}"


def format_timestamp(timestamp) -> str:
    """Format timestamp to string date."""
    if timestamp is None:
        return 'Unknown'
    if isinstance(timestamp, str):
        return timestamp[:10] if len(timestamp) >= 10 else timestamp
    if isinstance(timestamp, (int, float)):
        try:
            return datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d')
        except:
            return str(timestamp)
    return str(timestamp)


def format_duration(seconds: float) -> str:
    """Format duration in seconds to readable string."""
    if seconds < 60:
        return f"{seconds:.0f} seconds"
    elif seconds < 3600:
        minutes = seconds / 60
        secs = seconds % 60
        return f"{int(minutes)} minutes {int(secs)} seconds"
    else:
        hours = seconds / 3600
        minutes = (seconds % 3600) / 60
        return f"{int(hours)} hours {int(minutes)} minutes"


class ImprovedReportGenerator:
    """
    Generates storage audit reports following REPORT_REQUIREMENTS.md.

    Key principles:
    - Simple English, short sentences
    - Focus on insights and actions
    - Top folders (not hierarchical depth analysis)
    - Activity-based recommendations
    """

    def __init__(
        self,
        directory_name: str,
        analysis_data: Dict[str, Any],
        output_dir: str,
        snapshot_date: Optional[datetime] = None,
        compute_start_time: Optional[float] = None
    ):
        """
        Initialize improved report generator.

        Args:
            directory_name: Name of directory being analyzed
            analysis_data: Complete analysis data from StorageDataAnalyzer
            output_dir: Directory to save the report
            snapshot_date: Date when snapshot was created
            compute_start_time: Time when analysis started (for compute time tracking)
        """
        self.directory_name = directory_name
        self.data = analysis_data
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.report_lines = []
        self.html_components = []  # For styled tables and charts
        self.generation_time = datetime.now()
        self.snapshot_date = snapshot_date or self.generation_time
        self.compute_start_time = compute_start_time or time.time()

    def generate(self) -> Path:
        """
        Generate complete report following REPORT_REQUIREMENTS.md structure.

        Returns:
            Path to generated report file
        """
        logger.info(f"Generating improved report for {self.directory_name}")

        # Calculate compute time
        compute_time = time.time() - self.compute_start_time

        # Required sections in order
        self._add_metadata(compute_time)
        self._add_executive_summary()
        self._add_storage_overview()
        self._add_folder_activity_analysis()
        self._add_top_10_folders()
        self._add_storage_efficiency_hygiene()
        self._add_file_type_overview()
        self._add_file_age_analysis()

        if self.data.get('user_analysis'):
            self._add_user_ownership_usage()

        self._add_large_files()
        self._add_notes_and_limits()

        # Write report
        report_filename = f"storage_audit_{self.directory_name.replace('/', '_')}_{self.generation_time.strftime('%Y%m%d')}.md"
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

    def _add_metadata(self, compute_time: float):
        """Add report metadata (REQUIRED)."""
        self._add("# Storage Audit Report")
        self._add()
        self._add(f"**Directory:** `{self.directory_name}`")
        self._add()

        # Required metadata
        self._add("## Report Metadata")
        self._add()
        self._add(f"- **Report generated on:** {self.generation_time.strftime('%Y-%m-%d %H:%M')} UTC")
        self._add(f"- **Report compute time:** {format_duration(compute_time)}")
        self._add(f"- **Data snapshot date:** {self.snapshot_date.strftime('%Y-%m-%d')}")
        self._add()
        self._add("---")
        self._add()

    def _add_executive_summary(self):
        """
        Add Executive Summary (Most Important Section).

        Maximum 6 bullet points.
        Each bullet: What was found + Why it matters + What to do
        """
        self._add("## Executive Summary")
        self._add()
        self._add("This is the most important section of the report.")
        self._add()

        insights = []
        main = self.data.get('main_folder', {})
        total_size = main.get('total_size', 0)
        total_files = main.get('total_files', 0)

        # Insight 1: Storage concentration
        top_folders = self.data.get('top_folders', [])
        if top_folders and len(top_folders) >= 10:
            top_10_size = sum(f.get('total_size') or 0 for f in top_folders[:10])
            top_10_pct = (top_10_size / total_size * 100) if total_size > 0 else 0
            if top_10_pct > 50:
                insights.append(
                    f"**{top_10_pct:.0f}% of storage is in just 10 folders**  \n"
                    f"Storage is highly concentrated  \n"
                    f"→ Focus cleanup efforts on these folders"
                )

        # Insight 2: Old data analysis
        age_analysis = self.data.get('age_analysis', {})
        age_buckets = age_analysis.get('age_buckets', [])
        old_bucket = next((b for b in age_buckets if 'Over 1 year' in b.get('age_bucket', '')), None)
        if old_bucket:
            old_pct = ((old_bucket.get('total_size') or 0) / total_size * 100) if total_size > 0 else 0
            if old_pct > 60:
                insights.append(
                    f"**Most data has not changed in over one year ({old_pct:.0f}%)**  \n"
                    f"This means the data is likely inactive  \n"
                    f"→ Consider archive or cold storage"
                )

        # Insight 3: Active old folders (critical insight)
        activity = self.data.get('folder_activity', {})
        active_old = activity.get('active_old_folders', [])
        if active_old:
            insights.append(
                f"**{len(active_old)} folders contain old data but are accessed frequently**  \n"
                f"This means old data is still in use  \n"
                f"→ Do not archive without checking usage"
            )

        # Insight 4: User concentration
        user_analysis = self.data.get('user_analysis', {})
        if user_analysis:
            user_storage = user_analysis.get('user_storage', [])
            if len(user_storage) >= 3:
                top_3_size = sum(u.get('total_size') or 0 for u in user_storage[:3])
                top_3_pct = (top_3_size / total_size * 100) if total_size > 0 else 0
                if top_3_pct > 50:
                    insights.append(
                        f"**{len(user_storage[:3])} users own {top_3_pct:.0f}% of the data**  \n"
                        f"Cleanup and storage decisions should involve these users"
                    )

        # Insight 5: Cleanup opportunities
        cleanup = self.data.get('cleanup_opportunities', {})
        temp_size = cleanup.get('temporary_files', {}).get('total_size', 0)
        if temp_size > 1024**3:  # > 1GB
            insights.append(
                f"**{format_bytes(temp_size)} in temporary files**  \n"
                f"These files are safe to delete  \n"
                f"→ Immediate space recovery possible"
            )

        # Insight 6: Duplicates
        duplicates = cleanup.get('potential_duplicates', [])
        if duplicates:
            dup_size = sum(d.get('total_wasted') or 0 for d in duplicates[:10])
            if dup_size > 1024**3:  # > 1GB
                insights.append(
                    f"**{format_bytes(dup_size)} in potential duplicate files**  \n"
                    f"Same files stored in multiple locations  \n"
                    f"→ Review and consolidate"
                )

        # Add up to 6 insights
        for i, insight in enumerate(insights[:6], 1):
            self._add(f"{i}. {insight}")
            self._add()

        if not insights:
            self._add("- Storage appears well-managed")
            self._add("- No major cleanup opportunities identified")
            self._add()

        self._add("---")
        self._add()

    def _add_storage_overview(self):
        """Add Storage Overview section."""
        self._add("## Storage Overview")
        self._add()

        main = self.data.get('main_folder', {})

        self._add(f"- **Total size:** {format_bytes(main.get('total_size', 0))}")
        self._add(f"- **Total files:** {format_number(main.get('total_files', 0))}")
        self._add(f"- **Total folders:** {format_number(main.get('subdirectory_count', 0))}")
        self._add()

        # Simple statement
        top_folders = self.data.get('top_folders', [])
        if top_folders:
            self._add("Most storage is concentrated in a few locations.")
        self._add()
        self._add("---")
        self._add()

    def _add_folder_activity_analysis(self):
        """Add Folder Usage and Activity section."""
        self._add("## Folder Usage and Activity")
        self._add()
        self._add("This section shows how often folders are used.")
        self._add("Old files can still be used often.")
        self._add()

        activity = self.data.get('folder_activity', {})

        # Add folder activity calendar heatmaps for top heavy folders
        most_accessed = activity.get('most_accessed_folders', [])
        if most_accessed:
            try:
                from report_visualizations import generate_folder_activity_calendars
                calendar_base64 = generate_folder_activity_calendars(most_accessed, top_n=5)
                if calendar_base64:
                    self._add("### Activity Calendars for Top 5 Heavy Folders")
                    self._add()
                    self._add("Calendar view showing daily access patterns (GitHub-style):")
                    self._add()
                    self._add(f"![Folder Activity Calendars]({calendar_base64})")
                    self._add()
            except Exception as e:
                logger.debug(f"Could not generate folder activity calendars: {e}")

        # Active old folders (most important)
        active_old = activity.get('active_old_folders', [])
        if active_old:
            self._add("### Folders with Old Data but Recent Access")
            self._add()
            self._add("These folders are active and should not be archived:")
            self._add()

            # Create styled table using report_styling
            try:
                from report_styling import style_top_folders_table
                table_html = style_top_folders_table(active_old[:10])
                self.html_components.append(('active_old_folders', table_html))

                # Markdown table for .md version
                self._add("| Folder | Size | Files | Last Access |")
                self._add("|--------|------|-------|-------------|")
                for folder in active_old[:10]:
                    folder_name = folder.get('folder', '').split('/')[-1]
                    self._add(
                        f"| `{folder_name}` | {format_bytes(folder.get('total_size', 0))} | "
                        f"{format_number(folder.get('file_count', 0))} | "
                        f"{format_timestamp(folder.get('last_access'))} |"
                    )
            except ImportError:
                logger.warning("report_styling not available")
                # Fallback to simple table
                for folder in active_old[:10]:
                    self._add(f"- `{folder.get('folder')}` - {format_bytes(folder.get('total_size', 0))}")

            self._add()

        # Cold folders (archive candidates)
        cold = activity.get('cold_folders', [])
        if cold:
            self._add("### Folders with Little Recent Activity")
            self._add()
            self._add("These folders are large and rarely accessed.")
            self._add("These folders are good archive candidates:")
            self._add()

            self._add("| Folder | Size | Files | Last Access |")
            self._add("|--------|------|-------|-------------|")
            for folder in cold[:10]:
                folder_name = folder.get('folder', '').split('/')[-1]
                self._add(
                    f"| `{folder_name}` | {format_bytes(folder.get('total_size', 0))} | "
                    f"{format_number(folder.get('file_count', 0))} | "
                    f"{format_timestamp(folder.get('last_access'))} |"
                )
            self._add()

        # Files accessed in last week
        files_last_week = activity.get('files_accessed_last_week', [])
        if files_last_week:
            self._add("### Files Accessed in Last Week")
            self._add()
            self._add("Top 5 most recently accessed files:")
            self._add()
            self._add("| File | Size | Last Access |")
            self._add("|------|------|-------------|")
            for file in files_last_week:
                filename = file.get('path', '').split('/')[-1]
                self._add(
                    f"| `{filename}` | {format_bytes(file.get('size', 0))} | "
                    f"{format_timestamp(file.get('accessed_time'))} |"
                )
            self._add()

        # Files accessed in last month
        files_last_month = activity.get('files_accessed_last_month', [])
        if files_last_month and len(files_last_month) > len(files_last_week):
            self._add("### Files Accessed in Last Month")
            self._add()
            self._add("Top 5 most recently accessed files in the last 30 days:")
            self._add()
            self._add("| File | Size | Last Access |")
            self._add("|------|------|-------------|")
            for file in files_last_month:
                filename = file.get('path', '').split('/')[-1]
                self._add(
                    f"| `{filename}` | {format_bytes(file.get('size', 0))} | "
                    f"{format_timestamp(file.get('accessed_time'))} |"
                )
            self._add()

        self._add("---")
        self._add()

    def _add_top_10_folders(self):
        """
        Add Top 10 Biggest Folders section.

        IMPORTANT: No hierarchical depth analysis.
        Just the 10 heaviest folders with mini-analysis for each.
        """
        self._add("## Top 10 Biggest Folders")
        self._add()
        self._add("This section focuses on the 10 heaviest folders.")
        self._add("These folders matter the most.")
        self._add()

        top_folders = self.data.get('top_folders', [])[:10]

        if not top_folders:
            self._add("No folder data available.")
            self._add()
            return

        # Overview chart
        try:
            from report_visualizations import generate_top_folders_bar_chart
            chart_base64 = generate_top_folders_bar_chart(top_folders)
            if chart_base64:
                self._add(f"![Top 10 Folders]({chart_base64})")
                self._add()
        except Exception as e:
            logger.debug(f"Could not generate top folders chart: {e}")

        # Per-folder mini-analysis
        for i, folder in enumerate(top_folders, 1):
            self._add(f"### {i}. {folder.get('path', 'Unknown').split('/')[-1]}")
            self._add()

            # Folder summary
            self._add("**Summary:**")
            self._add()
            self._add(f"- Path: `{folder.get('path', 'Unknown')}`")
            self._add(f"- Total size: {format_bytes(folder.get('total_size', 0))}")
            self._add(f"- Number of files: {format_number(folder.get('file_count', 0))}")
            self._add()

            # Add sunburst chart for this folder's subfolders (if available)
            subfolders = folder.get('subfolders', [])
            if subfolders:
                try:
                    from report_visualizations import generate_sunburst_chart
                    sunburst_html = generate_sunburst_chart(folder.get('path', 'Unknown'), subfolders)
                    if sunburst_html:
                        self.html_components.append((f'sunburst_folder_{i}', sunburst_html))
                        self._add("*Sunburst chart available in HTML version*")
                        self._add()
                except Exception as e:
                    logger.debug(f"Could not generate sunburst chart: {e}")

            # Contents
            file_types = folder.get('file_types', [])
            if file_types:
                self._add("**Main file types:**")
                self._add()
                for ft in file_types[:3]:
                    self._add(f"- {ft.get('file_type', 'unknown')}: {format_bytes(ft.get('total_size', 0))}")
                self._add()

            # Activity
            access_stats = folder.get('access_stats', {})
            if access_stats:
                self._add("**Activity:**")
                self._add()
                accessed_last_week = access_stats.get('accessed_last_week', 0)
                accessed_last_month = access_stats.get('accessed_last_month', 0)
                if accessed_last_week > 0:
                    self._add(f"- Files accessed in last week: {format_number(accessed_last_week)}")
                if accessed_last_month > 0:
                    self._add(f"- Files accessed in last month: {format_number(accessed_last_month)}")
                self._add()

            # Time
            age_dist = folder.get('age_distribution', [])
            if age_dist:
                self._add("**File age:**")
                self._add()
                for age in age_dist:
                    self._add(f"- {age.get('age_bucket')}: {format_bytes(age.get('total_size', 0))}")
                self._add()

            # Insight (one or two sentences)
            insight = folder.get('insight', '')
            if insight:
                self._add("**Insight:**")
                self._add()
                self._add(insight)
                self._add()

        self._add("---")
        self._add()

    def _add_storage_efficiency_hygiene(self):
        """Add Storage Efficiency and Data Hygiene Review section."""
        self._add("## Storage Efficiency and Data Hygiene Review")
        self._add()
        self._add("This section focuses on low-risk cleanup opportunities.")
        self._add()

        cleanup = self.data.get('cleanup_opportunities', {})

        # Add cleanup opportunities chart
        try:
            from report_visualizations import generate_cleanup_opportunities_chart
            chart_base64 = generate_cleanup_opportunities_chart(cleanup)
            if chart_base64:
                self._add(f"![Cleanup Opportunities]({chart_base64})")
                self._add()
        except Exception as e:
            logger.debug(f"Could not generate cleanup chart: {e}")

        # Temporary files - grouped by folder with full paths
        self._add("### Temporary Files")
        self._add()
        self._add("Temporary files grouped by folder.")
        self._add()
        temp = cleanup.get('temporary_files', {})
        temp_count = temp.get('temp_file_count', 0)
        temp_size = temp.get('total_size', 0)
        temp_by_folder = temp.get('by_folder', [])

        if temp_count > 0:
            self._add(f"**Total:** {format_number(temp_count)} files, {format_bytes(temp_size)}")
            self._add()

            if temp_by_folder:
                self._add("| Folder | Count | Size | Example Paths |")
                self._add("|--------|-------|------|---------------|")
                for folder_data in temp_by_folder[:10]:
                    folder = folder_data.get('folder', 'Unknown')
                    count = folder_data.get('file_count', 0)
                    size = folder_data.get('total_size', 0)
                    examples = folder_data.get('example_paths', [])
                    example_str = "<br>".join([f"`{p}`" for p in examples[:3]]) if examples else "-"

                    self._add(
                        f"| `{folder}` | {format_number(count)} | "
                        f"{format_bytes(size)} | {example_str} |"
                    )
                self._add()

            self._add("**Insight:** Most temporary files come from output folders.")
            self._add("This suggests missing cleanup in jobs or scripts.")
        else:
            self._add("No significant temporary files detected.")
        self._add()

        # Empty files - grouped by folder with examples
        self._add("### Empty Files")
        self._add()
        self._add("Folders with the most empty files.")
        self._add()
        trash = self.data.get('trash_hidden', {})
        empty = trash.get('empty_files', {}) if trash else {}
        empty_count = empty.get('empty_file_count', 0)
        empty_by_folder = empty.get('by_folder', [])

        if empty_count > 0:
            self._add(f"**Total:** {format_number(empty_count)} empty files")
            self._add()

            if empty_by_folder:
                self._add("| Folder | Count | Example Files |")
                self._add("|--------|-------|---------------|")
                for folder_data in empty_by_folder[:10]:
                    folder = folder_data.get('folder', 'Unknown')
                    count = folder_data.get('file_count', 0)
                    examples = folder_data.get('example_paths', [])
                    # Show just filenames, not full paths, and limit to 3-5
                    filenames = [p.split('/')[-1] for p in examples[:5]] if examples else []
                    example_str = "<br>".join([f"`{fn}`" for fn in filenames]) if filenames else "-"

                    self._add(
                        f"| `{folder}` | {format_number(count)} | {example_str} |"
                    )
                self._add()

            self._add("**Insight:** Empty files often indicate failed jobs or broken scripts.")
        else:
            self._add("No empty files detected.")
        self._add()

        # Duplicates
        self._add("### Duplicate Files")
        self._add()
        duplicates = cleanup.get('potential_duplicates', [])

        if duplicates:
            self._add("Files marked as duplicates have:")
            self._add("- Identical file name")
            self._add("- Identical file size")
            self._add()

            self._add("| File | Size | Copies | Full Paths |")
            self._add("|------|------|--------|------------|")
            for dup in duplicates[:10]:
                file_locations = dup.get('file_locations', [])
                occurrence_count = dup.get('occurrence_count', 0)

                # Show full paths, but limit to first 3 if there are many
                paths_to_show = file_locations[:3] if len(file_locations) > 3 else file_locations
                paths_str = "<br>".join([f"`{p}`" for p in paths_to_show])
                if len(file_locations) > 3:
                    paths_str += f"<br>... and {len(file_locations) - 3} more"

                self._add(
                    f"| {dup.get('filename', 'unknown')} | {format_bytes(dup.get('size', 0))} | "
                    f"{format_number(occurrence_count)} | {paths_str} |"
                )
            self._add()
            self._add("**Insight:** These files appear to be exact copies stored in different locations.")
        else:
            self._add("No significant duplicate files detected.")
        self._add()

        self._add("---")
        self._add()

    def _add_file_type_overview(self):
        """Add File Type Overview section with location insights."""
        self._add("## File Type Overview")
        self._add()
        self._add("This section explains what types of files are stored and WHERE they are located.")
        self._add()

        main = self.data.get('main_folder', {})
        types = main.get('predominant_types', [])[:10]
        type_locations = self.data.get('file_type_locations', {})

        # Add file type treemap
        if types:
            try:
                from report_visualizations import generate_file_type_treemap
                chart_base64 = generate_file_type_treemap(types, top_n=10)
                if chart_base64:
                    self._add(f"![File Type Distribution]({chart_base64})")
                    self._add()
            except Exception as e:
                logger.debug(f"Could not generate file type treemap: {e}")

        if types:
            # Define file types with descriptions
            type_descriptions = {
                'nc': 'scientific data files (NetCDF format)',
                'nc4': 'scientific data files (NetCDF4 format)',
                'h5': 'HDF5 data files',
                'hdf5': 'HDF5 data files',
                'csv': 'table data',
                'tar': 'archive files',
                'gz': 'compressed archive files',
                'tmp': 'temporary files',
                'log': 'log files',
                'json': 'configuration or data files',
                'py': 'Python source code',
                'js': 'JavaScript code',
                'pkl': 'Python pickle data files',
                'zarr': 'Zarr array storage'
            }

            self._add("### File Types and Locations")
            self._add()

            for ft in types:
                ft_name = ft.get('file_type', '')
                count = ft.get('count', 0)
                size = ft.get('total_size', 0)
                desc = type_descriptions.get(ft_name, 'data files')

                self._add(f"**{ft_name}** ({desc})")
                self._add(f"- Total: {format_number(count)} files, {format_bytes(size)}")

                # Add location insights
                if ft_name in type_locations:
                    type_info = type_locations[ft_name]
                    locations = type_info.get('locations', [])
                    if locations:
                        folder_names = [loc['folder'].split('/')[-1] for loc in locations[:3]]
                        if len(folder_names) == 1:
                            self._add(f"- Most {ft_name} data is stored in `{folder_names[0]}`")
                        elif len(folder_names) > 1:
                            folders_str = ", ".join([f"`{fn}`" for fn in folder_names])
                            self._add(f"- Most {ft_name} data is stored in {len(folder_names)} folders: {folders_str}")

                    # Show top 5 biggest files of this type
                    top_files = type_info.get('top_files', [])
                    if top_files:
                        self._add(f"- Top 5 biggest {ft_name} files:")
                        for i, file in enumerate(top_files, 1):
                            filename = file.get('path', '').split('/')[-1]
                            file_size = file.get('size', 0)
                            self._add(f"  {i}. `{filename}` - {format_bytes(file_size)}")

                self._add()

        self._add("---")
        self._add()

    def _add_file_age_analysis(self):
        """Add File Age and Time Analysis section."""
        self._add("## File Age and Time Analysis")
        self._add()
        self._add("This section shows how old the data is.")
        self._add()

        age_analysis = self.data.get('age_analysis', {})
        age_buckets = age_analysis.get('age_buckets', [])

        # Add age histogram
        if age_analysis:
            try:
                from report_visualizations import generate_age_histogram
                chart_base64 = generate_age_histogram(age_analysis)
                if chart_base64:
                    self._add(f"![File Age Distribution]({chart_base64})")
                    self._add()
            except Exception as e:
                logger.debug(f"Could not generate age histogram: {e}")

        if age_buckets:
            self._add("| Age Range | Files | Size |")
            self._add("|-----------|-------|------|")
            for bucket in age_buckets:
                self._add(
                    f"| {bucket.get('age_bucket')} | {format_number(bucket.get('file_count', 0))} | "
                    f"{format_bytes(bucket.get('total_size', 0))} |"
                )
            self._add()

            # Generate insight
            old_bucket = next((b for b in age_buckets if 'Over 1 year' in b.get('age_bucket', '')), None)
            if old_bucket:
                total_size = sum(b.get('total_size') or 0 for b in age_buckets)
                old_pct = ((old_bucket.get('total_size') or 0) / total_size * 100) if total_size > 0 else 0

                if old_pct > 80:
                    self._add(f"**Insight:** Almost all data is older than one year ({old_pct:.0f}%).")
                    self._add("This storage is mostly archival, but activity must be checked.")
                elif old_pct > 50:
                    self._add(f"**Insight:** More than half the data is older than one year ({old_pct:.0f}%).")
                    self._add("Consider archiving old, unused data.")
                self._add()

        self._add("---")
        self._add()

    def _add_user_ownership_usage(self):
        """Add User Ownership and Usage section."""
        self._add("## User Ownership and Usage")
        self._add()

        user_analysis = self.data.get('user_analysis', {})
        user_storage = user_analysis.get('user_storage', [])[:15]

        if user_storage:
            # Add user activity chart
            try:
                from report_visualizations import generate_user_activity_chart
                chart_base64 = generate_user_activity_chart(user_storage, top_n=15)
                if chart_base64:
                    self._add(f"![Top Users by Storage]({chart_base64})")
                    self._add()
            except Exception as e:
                logger.debug(f"Could not generate user activity chart: {e}")

            self._add("### Users Owning Most Data")
            self._add()
            self._add("| Username | Files | Size |")
            self._add("|----------|-------|------|")
            for user in user_storage:
                self._add(
                    f"| {user.get('username')} | {format_number(user.get('file_count', 0))} | "
                    f"{format_bytes(user.get('total_size', 0))} |"
                )
            self._add()

            # Insight
            if len(user_storage) >= 3:
                total_size = sum(u.get('total_size') or 0 for u in user_storage)
                top_3_size = sum(u.get('total_size') or 0 for u in user_storage[:3])
                top_3_pct = (top_3_size / total_size * 100) if total_size > 0 else 0

                self._add(f"**Insight:** A small number of users own most of the data ({top_3_pct:.0f}% in top 3).")
                self._add("Cleanup and storage decisions should involve them.")
                self._add()

        self._add("---")
        self._add()

    def _add_large_files(self):
        """Add Large Files section."""
        self._add("## Large Files")
        self._add()

        hotspots = self.data.get('hotspots', {})
        largest = hotspots.get('largest_files', [])[:10] if hotspots else []

        # Add file size histogram for all files
        file_size_dist = self.data.get('file_size_distribution', [])
        if file_size_dist:
            try:
                from report_visualizations import generate_file_size_histogram
                chart_base64 = generate_file_size_histogram(file_size_dist)
                if chart_base64:
                    self._add(f"![File Size Distribution]({chart_base64})")
                    self._add()
            except Exception as e:
                logger.debug(f"Could not generate file size histogram: {e}")

        if largest:
            self._add("| File | Size | Modified | Type |")
            self._add("|------|------|----------|------|")
            for f in largest:
                filename = f.get('path', '').split('/')[-1]
                self._add(
                    f"| `{filename}` | {format_bytes(f.get('size', 0))} | "
                    f"{format_timestamp(f.get('modified_time'))} | {f.get('file_type', 'unknown')} |"
                )
            self._add()

            self._add("**Insight:** Large files that are old and rarely accessed are good archive candidates.")
        else:
            self._add("No unusually large files detected.")

        self._add()
        self._add("---")
        self._add()

    def _add_notes_and_limits(self):
        """Add Notes and Limits section."""
        self._add("## Notes and Limits")
        self._add()
        self._add("- This report is based on a snapshot of the filesystem")
        self._add("- File access times may not be available on all filesystems")
        self._add("- Duplicate detection is based on filename and size only")
        self._add("- Manual review is recommended before deleting files")
        self._add()

    def _generate_html(self, markdown_path: Path) -> Path:
        """Generate HTML version with styled tables and interactive charts."""
        try:
            import markdown

            with open(markdown_path, 'r') as f:
                md_content = f.read()

            html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

            # Inject interactive charts into HTML
            for component_id, component_html in self.html_components:
                # Find a good place to inject (e.g., before the next section)
                # For now, append at the end of relevant sections
                html_content += f"\n<div id='{component_id}' class='interactive-chart'>\n{component_html}\n</div>\n"

            # Enhanced CSS
            html_full = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Storage Audit Report - {self.directory_name}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            line-height: 1.6;
            max-width: 1400px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f5f7fa;
            color: #333;
        }}
        .content {{
            background-color: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #1a1a1a;
            border-bottom: 4px solid #0066cc;
            padding-bottom: 15px;
            margin-bottom: 30px;
        }}
        h2 {{
            color: #0066cc;
            border-bottom: 2px solid #e0e0e0;
            padding-bottom: 10px;
            margin-top: 40px;
            margin-bottom: 20px;
        }}
        h3 {{
            color: #004080;
            margin-top: 25px;
            margin-bottom: 15px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            background-color: white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        th {{
            background: linear-gradient(to bottom, #0066cc, #0052a3);
            color: white;
            padding: 14px;
            text-align: left;
            font-weight: 600;
            border: 1px solid #0052a3;
        }}
        td {{
            padding: 12px;
            border: 1px solid #e0e0e0;
        }}
        tr:nth-child(even) {{
            background-color: #f8f9fa;
        }}
        tr:hover {{
            background-color: #e8f4f8;
        }}
        code {{
            background-color: #f4f4f4;
            padding: 3px 6px;
            border-radius: 3px;
            font-family: "Courier New", Consolas, monospace;
            font-size: 0.9em;
            color: #c7254e;
        }}
        ul, ol {{
            padding-left: 30px;
            margin: 15px 0;
        }}
        li {{
            margin: 8px 0;
        }}
        hr {{
            border: none;
            border-top: 1px solid #e0e0e0;
            margin: 40px 0;
        }}
        strong {{
            color: #0066cc;
        }}
        .metadata {{
            background-color: #f8f9fa;
            padding: 20px;
            border-left: 4px solid #0066cc;
            margin: 20px 0;
            border-radius: 4px;
        }}
        .interactive-chart {{
            margin: 30px 0;
            padding: 20px;
            background-color: #fafafa;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        img {{
            max-width: 100%;
            height: auto;
            display: block;
            margin: 20px auto;
            border-radius: 4px;
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
            logger.warning("markdown package not available")
            return markdown_path
        except Exception as e:
            logger.error(f"Error generating HTML: {e}")
            return markdown_path
