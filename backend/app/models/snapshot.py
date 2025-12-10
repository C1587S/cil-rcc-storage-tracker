"""Snapshot models."""

from typing import Optional
from pydantic import BaseModel, Field


class Snapshot(BaseModel):
    """Snapshot metadata."""

    date: str = Field(..., description="Snapshot date (YYYY-MM-DD)")
    file_count: int = Field(..., description="Total number of files", ge=0)
    total_size: int = Field(..., description="Total size in bytes", ge=0)
    top_level_dirs: list[str] = Field(default_factory=list, description="List of top-level directories")
    scan_duration: Optional[float] = Field(None, description="Scan duration in seconds")
    created_at: Optional[str] = Field(None, description="When snapshot was created")

    class Config:
        json_schema_extra = {
            "example": {
                "date": "2024-01-15",
                "file_count": 1250000,
                "total_size": 429496729600,
                "top_level_dirs": ["cil", "battuta_shares", "gcp", "home_dirs"],
                "scan_duration": 3600.5,
                "created_at": "2024-01-15T23:45:00"
            }
        }


class SnapshotInfo(BaseModel):
    """Detailed snapshot information."""

    snapshot: Snapshot
    breakdown_by_dir: dict[str, dict] = Field(
        default_factory=dict,
        description="Breakdown by top-level directory"
    )
    breakdown_by_type: dict[str, dict] = Field(
        default_factory=dict,
        description="Breakdown by file type"
    )
    largest_files: list[dict] = Field(
        default_factory=list,
        description="Largest files in snapshot"
    )


class SnapshotComparison(BaseModel):
    """Comparison between two snapshots."""

    from_date: str = Field(..., description="Earlier snapshot date")
    to_date: str = Field(..., description="Later snapshot date")
    size_change: int = Field(..., description="Total size change in bytes")
    file_count_change: int = Field(..., description="Change in file count")
    files_added: int = Field(..., description="Number of files added", ge=0)
    files_removed: int = Field(..., description="Number of files removed", ge=0)
    files_modified: int = Field(..., description="Number of files modified", ge=0)
    largest_additions: list[dict] = Field(
        default_factory=list,
        description="Largest files added"
    )
    largest_removals: list[dict] = Field(
        default_factory=list,
        description="Largest files removed"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "from_date": "2024-01-15",
                "to_date": "2024-02-15",
                "size_change": 10737418240,
                "file_count_change": 5000,
                "files_added": 5500,
                "files_removed": 500,
                "files_modified": 2000,
                "largest_additions": [],
                "largest_removals": []
            }
        }
