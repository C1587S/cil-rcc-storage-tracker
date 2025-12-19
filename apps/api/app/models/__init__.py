"""Pydantic models for request/response validation."""
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field


# Response models


class SnapshotInfo(BaseModel):
    """Metadata about a single snapshot."""

    snapshot_date: date
    total_entries: int
    total_size: int
    total_files: int
    total_directories: int
    scan_started: datetime | None = None
    scan_completed: datetime | None = None
    top_level_dirs: list[str] = []
    import_time: datetime | None = None


class DirectoryEntry(BaseModel):
    """A directory entry (folder or file)."""

    path: str
    name: str
    is_directory: bool
    size: int  # bytes (use formatReadableSize on frontend)
    size_formatted: str | None = None
    owner: str | None = None
    file_type: str | None = None
    modified_time: int | None = None  # Unix timestamp
    accessed_time: int | None = None  # Unix timestamp
    file_count: int | None = None  # For directories
    dir_count: int | None = None  # For directories


class BrowseResponse(BaseModel):
    """Response for /api/browse (folders only)."""

    snapshot_date: date
    parent_path: str
    folders: list[DirectoryEntry]
    total_count: int


class ContentsResponse(BaseModel):
    """Response for /api/contents (folders + files)."""

    snapshot_date: date
    parent_path: str
    entries: list[DirectoryEntry]
    total_count: int
    offset: int
    limit: int


class SearchResponse(BaseModel):
    """Response for /api/search."""

    snapshot_date: date
    query: str
    mode: str
    results: list[DirectoryEntry]
    total_count: int
    limit: int


class QueryResponse(BaseModel):
    """Response for /api/query (SQL mode)."""

    snapshot_date: date
    sql: str
    columns: list[str]
    rows: list[list]  # Raw rows
    row_count: int
    execution_time_ms: float | None = None


# Request models


class SearchRequest(BaseModel):
    """Request for /api/search."""

    snapshot_date: date
    q: str = Field(..., min_length=1, description="Search query")
    mode: Literal["exact", "contains", "prefix", "suffix"] = "contains"
    scope_path: str | None = Field(None, description="Limit search to this directory subtree")
    include_files: bool = True
    include_dirs: bool = True
    limit: int = Field(100, ge=1, le=5000)


class QueryRequest(BaseModel):
    """Request for /api/query (SQL mode)."""

    snapshot_date: date
    sql: str = Field(..., min_length=10, description="SQL query to execute")
    limit: int = Field(1000, ge=1, le=5000)
