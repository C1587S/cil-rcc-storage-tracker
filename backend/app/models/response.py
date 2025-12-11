"""API response models."""

from typing import Any, Optional
from pydantic import BaseModel, Field

from app.models.file_entry import FileEntry


class ErrorResponse(BaseModel):
    """Error response model."""

    error: str = Field(..., description="Error type")
    detail: str = Field(..., description="Error details")
    path: Optional[str] = Field(None, description="Request path")


class SearchResponse(BaseModel):
    """Search results response."""

    results: list[FileEntry] = Field(default_factory=list, description="Search results")
    total: int = Field(..., description="Total number of results", ge=0)
    limit: int = Field(..., description="Result limit applied", ge=0)
    offset: int = Field(0, description="Result offset", ge=0)
    query: str = Field(..., description="Search query used")
    snapshot: Optional[str] = Field(None, description="Snapshot date searched")
    execution_time: float = Field(..., description="Query execution time in seconds", ge=0)


class FolderItem(BaseModel):
    """Folder or file item in breakdown."""

    name: str = Field(..., description="Folder or file name")
    path: str = Field(..., description="Full path")
    size: int = Field(..., description="Total size in bytes", ge=0)
    file_count: int = Field(..., description="Number of files", ge=0)
    is_directory: bool = Field(..., description="Whether this is a directory")
    file_type: Optional[str] = Field(None, description="File type if not directory")
    percentage: float = Field(..., description="Percentage of parent size", ge=0, le=100)
    last_modified: Optional[str] = Field(None, description="Last modified timestamp")


class FolderBreakdown(BaseModel):
    """Folder breakdown response."""

    path: str = Field(..., description="Folder path")
    total_size: int = Field(..., description="Total size in bytes", ge=0)
    file_count: int = Field(..., description="Total file count", ge=0)
    directory_count: int = Field(..., description="Total directory count", ge=0)
    children: list[FolderItem] = Field(default_factory=list, description="Folder items")
    snapshot: Optional[str] = Field(None, description="Snapshot date")
    depth: int = Field(1, description="Depth of breakdown", ge=1)


class FolderTreeNode(BaseModel):
    """Node in folder tree."""

    name: str = Field(..., description="Node name")
    path: str = Field(..., description="Full path")
    size: int = Field(..., description="Total size in bytes", ge=0)
    file_count: int = Field(..., description="Number of files in this node", ge=0)
    is_directory: bool = Field(..., description="Whether this is a directory")
    children: list["FolderTreeNode"] = Field(default_factory=list, description="Child nodes")
    percentage: float = Field(..., description="Percentage of root size", ge=0, le=100)


class FolderTree(BaseModel):
    """Folder tree response."""

    root: FolderTreeNode = Field(..., description="Root node of tree")
    snapshot: Optional[str] = Field(None, description="Snapshot date")
    max_depth: int = Field(..., description="Maximum depth of tree", ge=1)


class HeavyFilesResponse(BaseModel):
    """Heavy files response."""

    files: list[FileEntry] = Field(default_factory=list, description="List of heavy files")
    total: int = Field(..., description="Total number of files", ge=0)
    limit: int = Field(..., description="Limit applied", ge=0)
    snapshot: Optional[str] = Field(None, description="Snapshot date")
    total_size: int = Field(..., description="Combined size of all files", ge=0)


class AnalyticsResponse(BaseModel):
    """Generic analytics response."""

    data: list[dict[str, Any]] = Field(default_factory=list, description="Analytics data")
    summary: dict[str, Any] = Field(default_factory=dict, description="Summary statistics")
    snapshot: Optional[str] = Field(None, description="Snapshot date")
    query_type: str = Field(..., description="Type of analytics query")


class TimelineDataPoint(BaseModel):
    """Time-series data point."""

    date: str = Field(..., description="Date")
    value: float = Field(..., description="Value")
    label: Optional[str] = Field(None, description="Label for this data point")


class TimelineResponse(BaseModel):
    """Timeline data response."""

    data: list[TimelineDataPoint] = Field(default_factory=list, description="Time-series data")
    metric: str = Field(..., description="Metric being tracked")
    path: Optional[str] = Field(None, description="Path if filtered")
    start_date: str = Field(..., description="Start date")
    end_date: str = Field(..., description="End date")


# Update forward references
FolderTreeNode.model_rebuild()
