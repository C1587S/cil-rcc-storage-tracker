# Storage Audit and Data Cleaning Report Generation System

This system generates comprehensive data audit and data cleaning reports for server storage directories that are reaching capacity limits. Reports are written in simple, professional language and provide actionable recommendations for cleanup and optimization.

## Quick Start

### Installation (2 minutes)

```bash
cd reports
pip install -r requirements.txt
```

### Generate Your First Report (1 command)

```bash
python scripts/generate_report.py <snapshot.parquet> [output_dir]
```

**Example:**
```bash
# Auto-detect directory from snapshot (recommended)
python scripts/generate_report.py ../scan_testing/snapshot_2025-12-11.parquet ./output

# Or specify a directory to filter (optional)
python scripts/generate_report.py ../scan_testing/snapshot_2025-12-11.parquet /project/cil/gcp ./output
```

**Note:** The system now automatically extracts directory information from the parquet file itself. No need to specify target directories manually!

### Generate All Reports at Once

```bash
python scripts/generate_all_reports.py <snapshot.parquet> ./output
```

### View Reports

Reports are generated in two formats:

- **Markdown (.md)**: Open with any text editor
- **HTML (.html)**: Open with any web browser

When using `generate_all_reports.py`, open `output/index.html` to navigate all reports.

## Overview

The report generation system analyzes parquet snapshot files produced by the scanner and generates detailed reports covering:

- Storage usage analysis
- Hierarchical weight distribution
- Critical hotspots and large files
- File age and temporal analysis
- Cleanup opportunities
- User/homedir analysis (when applicable)
- File type classification
- Actionable recommendations

## System Architecture

```
reports/
├── scripts/
│   ├── data_analyzer.py          # Core data analysis module
│   ├── report_generator.py       # Markdown/HTML report generation
│   ├── generate_report.py        # Single report generation script
│   └── generate_all_reports.py   # Batch report generation
├── output/                        # Generated reports directory
├── templates/                     # Report templates (if custom needed)
├── requirements.txt               # Python dependencies
└── README.md                      # This file
```

## Installation

### Prerequisites

- Python 3.10 or higher
- Scanner snapshot files in Parquet format

### Setup

1. Navigate to the reports directory:
```bash
cd reports
```

2. Create a virtual environment (recommended):
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

### Generate a Single Report

To generate a report for a specific directory:

```bash
python scripts/generate_report.py <snapshot_file> <target_directory> [output_dir]
```

**Arguments:**
- `snapshot_file` - Path to the parquet snapshot file
- `target_directory` - Directory to analyze (e.g., `/project/cil/gcp`)
- `output_dir` - Output directory for reports (default: `./output`)

**Example:**
```bash
python scripts/generate_report.py \
    /scans/snapshot_2025-12-11.parquet \
    /project/cil/gcp \
    ./output
```

### Generate All Reports

To generate reports for all target directories in a single run:

```bash
python scripts/generate_all_reports.py <snapshot_file> [output_dir]
```

**Example:**
```bash
python scripts/generate_all_reports.py /scans/snapshot_2025-12-11.parquet ./output
```

This will generate reports for all configured directories:
- `/project/cil/battuta-shares-S3-archive`
- `/project/cil/battuta_shares`
- `/project/cil/gcp`
- `/project/cil/home_dirs`
- `/project/cil/kupe_shares`
- `/project/cil/norgay`
- `/project/cil/sacagawea_shares`

An index.html file will be created to navigate all generated reports.

## Report Sections

Each generated report includes the following sections:

### 1. Analysis of the Main Folder
- Total size and file counts
- Predominant file types
- Heaviest subdirectories
- Risk assessment

### 2. Hierarchical Weight Analysis
- Top-down storage distribution
- Heaviest folders at each level
- Structural observations

### 3. Hotspots (Critical Points)
- Heaviest subdirectories
- Largest individual files
- Files by size thresholds (>10GB, >50GB, >100GB)
- File types consuming most space

### 4. Age (Temporal) Analysis
- Files classified by age buckets:
  - 0-30 days
  - 31-90 days
  - 91-180 days
  - 6-12 months
  - Over 1 year
- Old files by type
- Directories with old content

### 5. Cleanup and Reduction Opportunities
- Potential duplicate files
- Checkpoint files
- Temporary and intermediate files
- Compression opportunities
- Priority recommendations (High, Medium, Low)

### 6. User / Homedir Analysis (when applicable)
- Storage usage per user
- Inactive users (>6 months)
- Cleanup suggestions per user

### 7. Analysis of Critically Large Files
- Files larger than 10GB, 50GB, and 100GB
- Location and file types
- Recommendations for archival

### 8. Trash, Hidden, and Residual Files
- Hidden files (starting with `.`)
- Cache directories (`.cache`, `__pycache__`, `.ipynb_checkpoints`, `node_modules`)
- Empty files (0 bytes)
- Trash folders

### 9. File Type Classification
- Breakdown by category (datasets, checkpoints, logs, temporary, etc.)
- Category analysis with recommendations

### 10. Summary and Recommendations
- Immediate actions (high impact)
- Short-term actions (medium impact)
- Long-term actions (preventive)
- Risk assessment with potential recovery estimates

## Output Formats

Reports are generated in two formats:

1. **Markdown (.md)** - Plain text format suitable for version control and command-line viewing
2. **HTML (.html)** - Formatted report with styling for web browsers

Both formats contain identical content and are generated simultaneously.

## Professional Logging

All report generation includes professional logging output:

```
2025-12-11 06:37:39 [INFO] ================================================================================
2025-12-11 06:37:39 [INFO] STORAGE AUDIT REPORT GENERATION
2025-12-11 06:37:39 [INFO] ================================================================================
2025-12-11 06:37:39 [INFO] Snapshot: /scans/snapshot.parquet
2025-12-11 06:37:39 [INFO] Target Directory: /project/cil/gcp
2025-12-11 06:37:39 [INFO] Output Directory: ./output
2025-12-11 06:37:39 [INFO]
2025-12-11 06:37:39 [INFO] Step 1: Initializing data analyzer
2025-12-11 06:37:39 [INFO] Loading snapshot from /scans/snapshot.parquet
...
2025-12-11 06:37:39 [INFO] Report generation successful
```

Logs provide visibility into the analysis process and help troubleshoot issues.

## Customization

### Modify Target Directories

To change the directories analyzed by `generate_all_reports.py`, edit the script:

```python
TARGET_DIRECTORIES = [
    "/project/cil/custom-dir-1",
    "/project/cil/custom-dir-2",
    # Add more directories here
]
```

### Adjust Analysis Parameters

Modify parameters in `data_analyzer.py`:

- Age buckets for temporal analysis
- Size thresholds for large file detection
- File type categories
- Number of results per section

### Custom Report Styling

Edit the HTML template in `report_generator.py`'s `_generate_html()` method to customize:

- Colors and fonts
- Layout and spacing
- Additional sections or visualizations

## Automated Report Generation

### Cron Job Example

Schedule monthly reports using cron:

```bash
# Run on the 1st of each month at 2 AM
0 2 1 * * cd /path/to/reports && python scripts/generate_all_reports.py /scans/latest_snapshot.parquet ./output/$(date +\%Y-\%m) >> logs/report_generation.log 2>&1
```

### Slurm Job Example

For HPC environments with Slurm:

```bash
#!/bin/bash
#SBATCH --job-name=generate-reports
#SBATCH --output=logs/report_%j.out
#SBATCH --time=01:00:00
#SBATCH --mem=8G

cd /path/to/reports
python scripts/generate_all_reports.py /scans/snapshot.parquet ./output
```

## Troubleshooting

### Common Issues

**Issue: "ModuleNotFoundError: No module named 'polars'"**
- Solution: Install dependencies with `pip install -r requirements.txt`

**Issue: "FileNotFoundError: snapshot file not found"**
- Solution: Verify the snapshot file path is correct and accessible

**Issue: "No files found matching pattern"**
- Solution: Ensure the target directory exists in the snapshot data

**Issue: "TypeError: unsupported operand type"**
- Solution: Update to the latest version with type conversion fixes

### Debug Mode

Enable detailed logging by modifying the logging level in the scripts:

```python
logging.basicConfig(
    level=logging.DEBUG,  # Change from INFO to DEBUG
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
```

## Best Practices

1. **Regular Generation**: Generate reports monthly or after each snapshot
2. **Historical Comparison**: Keep previous reports for trend analysis
3. **Action Tracking**: Use reports to create cleanup task lists
4. **Team Sharing**: Share HTML reports with team members via shared drives or internal wikis
5. **Backup Reports**: Version control markdown reports alongside code

## Performance Considerations

- Report generation time depends on snapshot size (typically 1-5 seconds per directory)
- Analysis is performed in-memory using DuckDB for efficiency
- Large snapshots (>1M files) may require 2-4GB RAM

## Support and Contributions

For issues, questions, or contributions:
- Review the system architecture in `CLAUDE.md`
- Check inline documentation in source files
- Test with sample data before production use

## License

[Specify license if applicable]

## Version

Version 1.0.0 - December 2025

---

*Reports are automatically generated from scanner snapshot data. All recommendations should be reviewed by system administrators before implementation.*
