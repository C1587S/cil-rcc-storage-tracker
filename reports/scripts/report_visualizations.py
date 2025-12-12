"""Visualization utilities for storage audit reports.

This module generates charts and visualizations for the storage audit reports,
including sunburst charts, heatmaps, bar charts, and activity calendars.
"""

import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import base64
from io import BytesIO

logger = logging.getLogger(__name__)

# Try to import visualization libraries
try:
    import matplotlib
    matplotlib.use('Agg')  # Non-interactive backend
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
    from matplotlib.patches import Rectangle
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False
    logger.warning("matplotlib not available, visualizations will be skipped")

try:
    import plotly.graph_objects as go
    import plotly.express as px
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False
    logger.warning("plotly not available, interactive visualizations will be skipped")

try:
    import seaborn as sns
    SEABORN_AVAILABLE = True
except ImportError:
    SEABORN_AVAILABLE = False
    logger.warning("seaborn not available, some visualizations will use basic matplotlib")


def save_fig_to_base64(fig) -> str:
    """Save matplotlib figure to base64 string for embedding in HTML."""
    buffer = BytesIO()
    fig.savefig(buffer, format='png', dpi=100, bbox_inches='tight')
    buffer.seek(0)
    image_base64 = base64.b64encode(buffer.read()).decode()
    plt.close(fig)
    return f"data:image/png;base64,{image_base64}"


def generate_top_folders_bar_chart(folders_data: List[Dict[str, Any]], top_n: int = 10) -> Optional[str]:
    """
    Generate a horizontal bar chart of top folders by size.

    Args:
        folders_data: List of folder dictionaries with 'path' and 'total_size'
        top_n: Number of top folders to show

    Returns:
        Base64 encoded image or None if visualization unavailable
    """
    if not MATPLOTLIB_AVAILABLE or not folders_data:
        return None

    # Sort and take top N
    sorted_folders = sorted(folders_data, key=lambda x: x.get('total_size', 0), reverse=True)[:top_n]

    # Extract data
    paths = [f['path'].split('/')[-1] if '/' in f['path'] else f['path'] for f in sorted_folders]
    sizes_gb = [f.get('total_size', 0) / (1024**3) for f in sorted_folders]

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6))

    # Create horizontal bar chart
    bars = ax.barh(range(len(paths)), sizes_gb, color='#5fba7d')

    # Customize
    ax.set_yticks(range(len(paths)))
    ax.set_yticklabels(paths)
    ax.set_xlabel('Size (GB)', fontsize=12)
    ax.set_title(f'Top {top_n} Folders by Size', fontsize=14, fontweight='bold')
    ax.grid(axis='x', alpha=0.3)

    # Add value labels
    for i, (bar, size) in enumerate(zip(bars, sizes_gb)):
        ax.text(size, i, f' {size:.2f} GB', va='center', fontsize=9)

    plt.tight_layout()

    return save_fig_to_base64(fig)


def generate_file_type_pie_chart(file_types: List[Dict[str, Any]], top_n: int = 10) -> Optional[str]:
    """
    Generate a pie chart of file type distribution.

    Args:
        file_types: List of file type dictionaries
        top_n: Number of top types to show

    Returns:
        Base64 encoded image or None if visualization unavailable
    """
    if not MATPLOTLIB_AVAILABLE or not file_types:
        return None

    # Sort and take top N
    sorted_types = sorted(file_types, key=lambda x: x.get('total_size', 0), reverse=True)[:top_n]

    # Extract data
    labels = [ft.get('file_type', 'unknown') for ft in sorted_types]
    sizes = [ft.get('total_size', 0) for ft in sorted_types]

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 7))

    # Create pie chart
    colors = plt.cm.Set3(range(len(labels)))
    wedges, texts, autotexts = ax.pie(
        sizes,
        labels=labels,
        autopct='%1.1f%%',
        colors=colors,
        startangle=90
    )

    # Customize text
    for text in texts:
        text.set_fontsize(10)
    for autotext in autotexts:
        autotext.set_color('white')
        autotext.set_fontweight('bold')
        autotext.set_fontsize(9)

    ax.set_title('File Type Distribution by Size', fontsize=14, fontweight='bold')

    plt.tight_layout()

    return save_fig_to_base64(fig)


def generate_age_distribution_chart(age_buckets: List[Dict[str, Any]]) -> Optional[str]:
    """
    Generate a bar chart of file age distribution.

    Args:
        age_buckets: List of age bucket dictionaries

    Returns:
        Base64 encoded image or None if visualization unavailable
    """
    if not MATPLOTLIB_AVAILABLE or not age_buckets:
        return None

    # Extract data
    labels = [bucket.get('age_bucket', 'Unknown') for bucket in age_buckets]
    sizes_gb = [bucket.get('total_size', 0) / (1024**3) for bucket in age_buckets]
    counts = [bucket.get('file_count', 0) for bucket in age_buckets]

    # Create figure with two subplots
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    # Size distribution
    bars1 = ax1.bar(range(len(labels)), sizes_gb, color='#ff9800')
    ax1.set_xticks(range(len(labels)))
    ax1.set_xticklabels(labels, rotation=45, ha='right')
    ax1.set_ylabel('Size (GB)', fontsize=12)
    ax1.set_title('Storage by File Age', fontsize=12, fontweight='bold')
    ax1.grid(axis='y', alpha=0.3)

    # Add value labels
    for bar, size in zip(bars1, sizes_gb):
        height = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width()/2., height,
                f'{size:.1f}', ha='center', va='bottom', fontsize=9)

    # File count distribution
    bars2 = ax2.bar(range(len(labels)), counts, color='#2196f3')
    ax2.set_xticks(range(len(labels)))
    ax2.set_xticklabels(labels, rotation=45, ha='right')
    ax2.set_ylabel('File Count', fontsize=12)
    ax2.set_title('File Count by Age', fontsize=12, fontweight='bold')
    ax2.grid(axis='y', alpha=0.3)

    # Add value labels
    for bar, count in zip(bars2, counts):
        height = bar.get_height()
        ax2.text(bar.get_x() + bar.get_width()/2., height,
                f'{count:,}', ha='center', va='bottom', fontsize=9)

    plt.tight_layout()

    return save_fig_to_base64(fig)


def generate_sunburst_chart(folder_path: str, subfolders: List[Dict[str, Any]]) -> Optional[str]:
    """
    Generate a sunburst chart showing subfolder structure.

    Args:
        folder_path: Parent folder path
        subfolders: List of subfolder dictionaries

    Returns:
        HTML string with plotly chart or None if unavailable
    """
    if not PLOTLY_AVAILABLE or not subfolders:
        return None

    # Prepare data for sunburst
    labels = [folder_path]
    parents = ['']
    values = [sum(sf.get('total_size', 0) for sf in subfolders)]

    for sf in subfolders[:20]:  # Limit to 20 subfolders
        subfolder_name = sf.get('path', '').split('/')[-1]
        labels.append(subfolder_name)
        parents.append(folder_path)
        values.append(sf.get('total_size', 0))

    # Create sunburst chart
    fig = go.Figure(go.Sunburst(
        labels=labels,
        parents=parents,
        values=values,
        branchvalues="total",
        marker=dict(colorscale='Viridis'),
        hovertemplate='<b>%{label}</b><br>Size: %{value:,.0f} bytes<extra></extra>'
    ))

    fig.update_layout(
        title=f'Subfolder Structure: {folder_path.split("/")[-1]}',
        width=600,
        height=600
    )

    return fig.to_html(include_plotlyjs='cdn', div_id=f'sunburst_{hash(folder_path)}')


def generate_activity_heatmap(activity_data: List[Dict[str, Any]]) -> Optional[str]:
    """
    Generate a heatmap showing folder access activity over time.

    Args:
        activity_data: List of activity dictionaries with folder, date, access_count

    Returns:
        Base64 encoded image or None if visualization unavailable
    """
    if not MATPLOTLIB_AVAILABLE or not activity_data:
        return None

    try:
        import pandas as pd
        import numpy as np

        # Convert to DataFrame
        df = pd.DataFrame(activity_data)

        if df.empty or 'folder' not in df.columns:
            return None

        # Pivot for heatmap
        if 'date' in df.columns and 'access_count' in df.columns:
            pivot = df.pivot_table(
                values='access_count',
                index='folder',
                columns='date',
                fill_value=0
            )
        else:
            # Simple version with just folders and counts
            pivot = df.set_index('folder')[['access_count']] if 'access_count' in df.columns else df

        # Create figure
        fig, ax = plt.subplots(figsize=(12, min(8, len(pivot) * 0.5 + 2)))

        # Create heatmap
        if SEABORN_AVAILABLE:
            sns.heatmap(
                pivot,
                cmap='YlOrRd',
                annot=True,
                fmt='.0f',
                cbar_kws={'label': 'Access Count'},
                ax=ax
            )
        else:
            im = ax.imshow(pivot.values, cmap='YlOrRd', aspect='auto')
            ax.set_xticks(range(len(pivot.columns)))
            ax.set_yticks(range(len(pivot.index)))
            ax.set_xticklabels(pivot.columns, rotation=45, ha='right')
            ax.set_yticklabels(pivot.index)
            plt.colorbar(im, ax=ax, label='Access Count')

        ax.set_title('Folder Access Activity', fontsize=14, fontweight='bold')
        ax.set_xlabel('Date', fontsize=12)
        ax.set_ylabel('Folder', fontsize=12)

        plt.tight_layout()

        return save_fig_to_base64(fig)

    except Exception as e:
        logger.warning(f"Error generating activity heatmap: {e}")
        return None


def generate_user_activity_chart(user_data: List[Dict[str, Any]], top_n: int = 15) -> Optional[str]:
    """
    Generate a bar chart showing top users by storage usage.

    Args:
        user_data: List of user dictionaries
        top_n: Number of top users to show

    Returns:
        Base64 encoded image or None if visualization unavailable
    """
    if not MATPLOTLIB_AVAILABLE or not user_data:
        return None

    # Sort and take top N
    sorted_users = sorted(user_data, key=lambda x: x.get('total_size', 0), reverse=True)[:top_n]

    # Extract data
    users = [u.get('username', 'unknown') for u in sorted_users]
    sizes_gb = [u.get('total_size', 0) / (1024**3) for u in sorted_users]

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 7))

    # Create horizontal bar chart
    bars = ax.barh(range(len(users)), sizes_gb, color='#9c27b0')

    # Customize
    ax.set_yticks(range(len(users)))
    ax.set_yticklabels(users)
    ax.set_xlabel('Storage (GB)', fontsize=12)
    ax.set_title(f'Top {top_n} Users by Storage Usage', fontsize=14, fontweight='bold')
    ax.grid(axis='x', alpha=0.3)

    # Add value labels
    for i, (bar, size) in enumerate(zip(bars, sizes_gb)):
        ax.text(size, i, f' {size:.2f} GB', va='center', fontsize=9)

    plt.tight_layout()

    return save_fig_to_base64(fig)


def generate_cleanup_opportunities_chart(cleanup_data: Dict[str, Any]) -> Optional[str]:
    """
    Generate a bar chart showing cleanup opportunities by category.

    Args:
        cleanup_data: Dictionary with cleanup categories and sizes

    Returns:
        Base64 encoded image or None if visualization unavailable
    """
    if not MATPLOTLIB_AVAILABLE or not cleanup_data:
        return None

    # Extract categories and sizes
    categories = []
    sizes_gb = []

    if cleanup_data.get('temporary_files', {}).get('total_size', 0) > 0:
        categories.append('Temporary Files')
        sizes_gb.append(cleanup_data['temporary_files']['total_size'] / (1024**3))

    if cleanup_data.get('checkpoints', {}).get('total_size', 0) > 0:
        categories.append('Checkpoints')
        sizes_gb.append(cleanup_data['checkpoints']['total_size'] / (1024**3))

    if cleanup_data.get('cache_files', {}).get('total_size', 0) > 0:
        categories.append('Cache Files')
        sizes_gb.append(cleanup_data['cache_files']['total_size'] / (1024**3))

    duplicates = cleanup_data.get('potential_duplicates', [])
    if duplicates:
        dup_size = sum(d.get('total_wasted', 0) for d in duplicates)
        if dup_size > 0:
            categories.append('Duplicates')
            sizes_gb.append(dup_size / (1024**3))

    if not categories:
        return None

    # Create figure
    fig, ax = plt.subplots(figsize=(10, 6))

    # Create bar chart
    colors = ['#f44336', '#ff9800', '#ffc107', '#4caf50']
    bars = ax.bar(range(len(categories)), sizes_gb, color=colors[:len(categories)])

    # Customize
    ax.set_xticks(range(len(categories)))
    ax.set_xticklabels(categories, rotation=45, ha='right')
    ax.set_ylabel('Potential Recovery (GB)', fontsize=12)
    ax.set_title('Storage Cleanup Opportunities', fontsize=14, fontweight='bold')
    ax.grid(axis='y', alpha=0.3)

    # Add value labels
    for bar, size in zip(bars, sizes_gb):
        height = bar.get_height()
        ax.text(bar.get_x() + bar.get_width()/2., height,
                f'{size:.2f} GB', ha='center', va='bottom', fontsize=10, fontweight='bold')

    plt.tight_layout()

    return save_fig_to_base64(fig)
