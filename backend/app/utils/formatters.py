"""Data formatting utilities."""

from datetime import datetime
from typing import Optional


def format_bytes(bytes_value: int, decimal_places: int = 2) -> str:
    """
    Format bytes to human-readable string.

    Args:
        bytes_value: Size in bytes
        decimal_places: Number of decimal places

    Returns:
        Formatted string (e.g., "1.50 GB")
    """
    if bytes_value < 0:
        return "0 B"

    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    unit_index = 0

    size = float(bytes_value)
    while size >= 1024.0 and unit_index < len(units) - 1:
        size /= 1024.0
        unit_index += 1

    return f"{size:.{decimal_places}f} {units[unit_index]}"


def format_timestamp(timestamp: Optional[datetime], format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
    """
    Format timestamp to string.

    Args:
        timestamp: Datetime object
        format_str: Format string

    Returns:
        Formatted timestamp string
    """
    if timestamp is None:
        return "N/A"

    if isinstance(timestamp, str):
        return timestamp

    return timestamp.strftime(format_str)


def format_percentage(value: float, total: float, decimal_places: int = 1) -> str:
    """
    Format value as percentage of total.

    Args:
        value: Value
        total: Total
        decimal_places: Number of decimal places

    Returns:
        Formatted percentage string (e.g., "25.5%")
    """
    if total == 0:
        return "0.0%"

    percentage = (value / total) * 100
    return f"{percentage:.{decimal_places}f}%"


def format_number(number: int, use_separator: bool = True) -> str:
    """
    Format number with thousand separators.

    Args:
        number: Number to format
        use_separator: Use comma separator

    Returns:
        Formatted number string
    """
    if use_separator:
        return f"{number:,}"
    return str(number)


def format_duration(seconds: float) -> str:
    """
    Format duration in seconds to human-readable string.

    Args:
        seconds: Duration in seconds

    Returns:
        Formatted duration (e.g., "1h 23m 45s")
    """
    if seconds < 60:
        return f"{seconds:.1f}s"

    minutes = int(seconds // 60)
    remaining_seconds = int(seconds % 60)

    if minutes < 60:
        return f"{minutes}m {remaining_seconds}s"

    hours = minutes // 60
    remaining_minutes = minutes % 60

    return f"{hours}h {remaining_minutes}m {remaining_seconds}s"


def truncate_path(path: str, max_length: int = 80, separator: str = "...") -> str:
    """
    Truncate path if too long, keeping beginning and end.

    Args:
        path: File path
        max_length: Maximum length
        separator: Separator to use in middle

    Returns:
        Truncated path
    """
    if len(path) <= max_length:
        return path

    # Calculate how much to show on each side
    side_length = (max_length - len(separator)) // 2

    return f"{path[:side_length]}{separator}{path[-side_length:]}"
