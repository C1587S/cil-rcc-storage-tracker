"""Validation utilities."""

import re
from datetime import datetime
from typing import Optional
from fastapi import HTTPException


def validate_date_format(date_str: str) -> bool:
    """
    Validate date string format (YYYY-MM-DD).

    Args:
        date_str: Date string to validate

    Returns:
        True if valid

    Raises:
        HTTPException: If invalid format
    """
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date format: {date_str}. Expected YYYY-MM-DD"
        )


def validate_path(path: str) -> str:
    """
    Validate and sanitize path.

    Args:
        path: Path to validate

    Returns:
        Sanitized path

    Raises:
        HTTPException: If invalid path
    """
    if not path:
        raise HTTPException(status_code=400, detail="Path cannot be empty")

    # Remove any potentially dangerous patterns
    if ".." in path:
        raise HTTPException(status_code=400, detail="Path cannot contain '..'")

    # Normalize path
    path = path.strip()

    # Ensure path starts with /
    if not path.startswith("/"):
        path = "/" + path

    return path


def sanitize_pattern(pattern: str, regex: bool = True) -> str:
    """
    Sanitize search pattern to prevent injection.

    Args:
        pattern: Search pattern
        regex: Whether pattern is regex

    Returns:
        Sanitized pattern

    Raises:
        HTTPException: If pattern is invalid
    """
    if not pattern:
        raise HTTPException(status_code=400, detail="Pattern cannot be empty")

    if len(pattern) > 500:
        raise HTTPException(
            status_code=400,
            detail="Pattern too long (max 500 characters)"
        )

    if regex:
        # Validate regex pattern
        try:
            re.compile(pattern)
        except re.error as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid regex pattern: {str(e)}"
            )

    # Escape single quotes for SQL safety
    pattern = pattern.replace("'", "''")

    return pattern


def validate_limit(limit: Optional[int], max_limit: int, default_limit: int) -> int:
    """
    Validate and normalize limit parameter.

    Args:
        limit: Requested limit
        max_limit: Maximum allowed limit
        default_limit: Default limit if None

    Returns:
        Validated limit value

    Raises:
        HTTPException: If limit is invalid
    """
    if limit is None:
        return default_limit

    if limit < 1:
        raise HTTPException(
            status_code=400,
            detail="Limit must be greater than 0"
        )

    if limit > max_limit:
        raise HTTPException(
            status_code=400,
            detail=f"Limit exceeds maximum allowed value ({max_limit})"
        )

    return limit


def validate_depth(depth: int) -> int:
    """
    Validate depth parameter.

    Args:
        depth: Depth value

    Returns:
        Validated depth

    Raises:
        HTTPException: If depth is invalid
    """
    if depth < 1:
        raise HTTPException(
            status_code=400,
            detail="Depth must be at least 1"
        )

    if depth > 10:
        raise HTTPException(
            status_code=400,
            detail="Depth cannot exceed 10 (performance limitation)"
        )

    return depth


def validate_file_size(size: Optional[int]) -> Optional[int]:
    """
    Validate file size parameter.

    Args:
        size: File size in bytes

    Returns:
        Validated size or None

    Raises:
        HTTPException: If size is invalid
    """
    if size is None:
        return None

    if size < 0:
        raise HTTPException(
            status_code=400,
            detail="File size cannot be negative"
        )

    # Reasonable upper limit (100TB)
    if size > 100 * 1024 * 1024 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="File size exceeds reasonable limit"
        )

    return size
