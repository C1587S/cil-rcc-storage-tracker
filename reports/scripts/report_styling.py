"""Styling utilities for storage audit reports using pandas Styler.

This module provides styled table generation using pandas DataFrame.style
for professional, easy-to-read tables with color bars, gradients, and highlighting.
"""

import pandas as pd
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


def format_bytes_for_display(val):
    """Format bytes for display in tables."""
    if pd.isna(val) or val is None:
        return "0 B"

    val = float(val)
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if val < 1024.0:
            return f"{val:.2f} {unit}"
        val /= 1024.0
    return f"{val:.2f} PB"


def format_number_for_display(val):
    """Format number with thousand separators."""
    if pd.isna(val) or val is None:
        return "0"
    return f"{int(val):,}"


def style_size_table(df: pd.DataFrame, size_columns: List[str] = None) -> str:
    """
    Style a DataFrame with size columns using color bars and formatting.

    Args:
        df: DataFrame to style
        size_columns: List of column names containing size data (in bytes)

    Returns:
        HTML string of styled table
    """
    if df.empty:
        return "<p>No data available</p>"

    if size_columns is None:
        # Auto-detect columns with 'size' in the name
        size_columns = [col for col in df.columns if 'size' in col.lower()]

    # Create a copy to avoid modifying original
    df_styled = df.copy()

    # Convert size columns to float to avoid Decimal issues with pandas bar/gradient methods
    for col in size_columns:
        if col in df_styled.columns:
            df_styled[col] = df_styled[col].apply(lambda x: float(x) if x is not None else 0.0)

    # Create styler
    styler = df_styled.style

    # Apply color bars to size columns
    for col in size_columns:
        if col in df_styled.columns:
            styler = styler.bar(
                subset=[col],
                color='#5fba7d',  # Green color
                vmin=0,
                vmax=df_styled[col].max() if not df_styled[col].empty else 1
            )

    # Format size columns
    for col in size_columns:
        if col in df_styled.columns:
            styler = styler.format({col: format_bytes_for_display})

    # Format count/number columns
    count_columns = [col for col in df_styled.columns
                     if any(x in col.lower() for x in ['count', 'files', 'number'])]
    for col in count_columns:
        if col in df_styled.columns and col not in size_columns:
            styler = styler.format({col: format_number_for_display})

    # Apply base styling
    styler = styler.set_table_styles([
        {'selector': 'thead th', 'props': [
            ('background-color', '#0066cc'),
            ('color', 'white'),
            ('font-weight', 'bold'),
            ('text-align', 'left'),
            ('padding', '12px'),
            ('border', '1px solid #ddd')
        ]},
        {'selector': 'tbody td', 'props': [
            ('padding', '10px'),
            ('border', '1px solid #ddd'),
            ('text-align', 'left')
        ]},
        {'selector': 'tbody tr:nth-child(even)', 'props': [
            ('background-color', '#f9f9f9')
        ]},
        {'selector': 'tbody tr:hover', 'props': [
            ('background-color', '#e8f4f8')
        ]},
        {'selector': 'table', 'props': [
            ('border-collapse', 'collapse'),
            ('width', '100%'),
            ('margin', '20px 0'),
            ('box-shadow', '0 2px 4px rgba(0,0,0,0.1)')
        ]}
    ])

    # Apply gradient background to size columns
    for col in size_columns:
        if col in df_styled.columns:
            styler = styler.background_gradient(
                subset=[col],
                cmap='YlOrRd',  # Yellow-Orange-Red gradient
                vmin=0,
                vmax=df_styled[col].max() if not df_styled[col].empty else 1
            )

    return styler.to_html()


def style_top_folders_table(folders_data: List[Dict[str, Any]]) -> str:
    """
    Create a styled table for top folders with size bars and highlighting.

    Args:
        folders_data: List of folder dictionaries with keys: path, size, file_count

    Returns:
        HTML string of styled table
    """
    if not folders_data:
        return "<p>No folder data available</p>"

    df = pd.DataFrame(folders_data)

    # Rename columns for display
    column_mapping = {
        'directory': 'Folder Path',
        'path': 'Folder Path',
        'total_size': 'Total Size',
        'size': 'Total Size',
        'file_count': 'File Count',
        'largest_file': 'Largest File'
    }

    df = df.rename(columns={k: v for k, v in column_mapping.items() if k in df.columns})

    # Select and order columns
    display_columns = ['Folder Path', 'File Count', 'Total Size']
    if 'Largest File' in df.columns:
        display_columns.append('Largest File')

    df = df[[col for col in display_columns if col in df.columns]]

    return style_size_table(df, size_columns=['Total Size', 'Largest File'])


def style_file_type_table(file_types: List[Dict[str, Any]], total_size: float) -> str:
    """
    Create a styled table for file type distribution.

    Args:
        file_types: List of file type dictionaries
        total_size: Total size for percentage calculation

    Returns:
        HTML string of styled table
    """
    if not file_types:
        return "<p>No file type data available</p>"

    df = pd.DataFrame(file_types)

    # Calculate percentage if not present
    if 'percentage' not in df.columns and 'total_size' in df.columns:
        df['percentage'] = (df['total_size'] / total_size * 100).round(2)

    # Rename columns
    column_mapping = {
        'file_type': 'File Type',
        'type': 'File Type',
        'count': 'Count',
        'file_count': 'Count',
        'total_size': 'Total Size',
        'avg_size': 'Avg Size',
        'max_size': 'Max Size',
        'percentage': 'Percentage'
    }

    df = df.rename(columns={k: v for k, v in column_mapping.items() if k in df.columns})

    # Format percentage column
    if 'Percentage' in df.columns:
        df['Percentage'] = df['Percentage'].apply(lambda x: f"{x:.2f}%")

    return style_size_table(df, size_columns=['Total Size', 'Avg Size', 'Max Size'])


def style_age_distribution_table(age_buckets: List[Dict[str, Any]]) -> str:
    """
    Create a styled table for age distribution.

    Args:
        age_buckets: List of age bucket dictionaries

    Returns:
        HTML string of styled table
    """
    if not age_buckets:
        return "<p>No age distribution data available</p>"

    df = pd.DataFrame(age_buckets)

    column_mapping = {
        'age_bucket': 'Age Range',
        'bucket': 'Age Range',
        'file_count': 'File Count',
        'total_size': 'Total Size'
    }

    df = df.rename(columns={k: v for k, v in column_mapping.items() if k in df.columns})

    # Calculate percentage
    if 'Total Size' in df.columns:
        total = df['Total Size'].sum()
        df['Percentage'] = (df['Total Size'] / total * 100).round(2).apply(lambda x: f"{x:.2f}%")

    return style_size_table(df, size_columns=['Total Size'])


def style_user_storage_table(user_data: List[Dict[str, Any]]) -> str:
    """
    Create a styled table for user storage analysis.

    Args:
        user_data: List of user storage dictionaries

    Returns:
        HTML string of styled table
    """
    if not user_data:
        return "<p>No user data available</p>"

    df = pd.DataFrame(user_data)

    column_mapping = {
        'username': 'Username',
        'file_count': 'File Count',
        'total_size': 'Total Size',
        'last_access': 'Last Access',
        'last_modification': 'Last Modified'
    }

    df = df.rename(columns={k: v for k, v in column_mapping.items() if k in df.columns})

    # Format dates
    for col in ['Last Access', 'Last Modified']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')

    return style_size_table(df, size_columns=['Total Size'])


def style_cleanup_opportunities_table(cleanup_data: List[Dict[str, Any]]) -> str:
    """
    Create a styled table for cleanup opportunities with highlighting.

    Args:
        cleanup_data: List of cleanup opportunity dictionaries

    Returns:
        HTML string of styled table
    """
    if not cleanup_data:
        return "<p>No cleanup opportunities identified</p>"

    df = pd.DataFrame(cleanup_data)

    # Highlight rows with high potential savings
    def highlight_high_impact(row):
        if 'total_wasted' in row.index or 'total_size' in row.index:
            size_col = 'total_wasted' if 'total_wasted' in row.index else 'total_size'
            if row[size_col] > 1024**3:  # > 1GB
                return ['background-color: #ffe6e6'] * len(row)
        return [''] * len(row)

    styler = df.style.apply(highlight_high_impact, axis=1)

    # Format size columns
    size_cols = [col for col in df.columns if 'size' in col.lower() or 'wasted' in col.lower()]
    for col in size_cols:
        if col in df.columns:
            styler = styler.format({col: format_bytes_for_display})

    return styler.to_html()


def create_summary_box(title: str, items: List[str], box_type: str = 'info') -> str:
    """
    Create a styled summary box for key insights.

    Args:
        title: Box title
        items: List of bullet points
        box_type: Type of box - 'info', 'success', 'warning', 'danger'

    Returns:
        HTML string of styled box
    """
    colors = {
        'info': {'bg': '#e8f4f8', 'border': '#0066cc', 'title': '#004080'},
        'success': {'bg': '#e8f5e9', 'border': '#4caf50', 'title': '#2e7d32'},
        'warning': {'bg': '#fff8e1', 'border': '#ffc107', 'title': '#f57c00'},
        'danger': {'bg': '#ffebee', 'border': '#f44336', 'title': '#c62828'}
    }

    color = colors.get(box_type, colors['info'])

    items_html = '\n'.join([f'<li>{item}</li>' for item in items])

    html = f"""
    <div style="
        background-color: {color['bg']};
        border-left: 4px solid {color['border']};
        padding: 20px;
        margin: 20px 0;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    ">
        <h3 style="
            margin-top: 0;
            color: {color['title']};
            font-size: 1.2em;
        ">{title}</h3>
        <ul style="
            margin: 10px 0 0 0;
            padding-left: 20px;
        ">
            {items_html}
        </ul>
    </div>
    """

    return html
