"""File entry models."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class FileEntry(BaseModel):
    """File entry model matching scanner output schema."""

    path: str = Field(..., description="Full absolute path")
    size: int = Field(..., description="File size in bytes", ge=0)
    modified_time: datetime = Field(..., description="Last modified timestamp")
    accessed_time: datetime = Field(..., description="Last accessed timestamp")
    created_time: Optional[datetime] = Field(None, description="Creation timestamp")
    file_type: str = Field(..., description="File extension or 'directory'")
    inode: Optional[int] = Field(None, description="Inode number")
    permissions: Optional[int] = Field(None, description="Unix permissions")
    parent_path: str = Field(..., description="Parent directory path")
    depth: Optional[int] = Field(None, description="Depth from scan root", ge=0)
    top_level_dir: str = Field(..., description="Top-level directory name")
    snapshot_date: Optional[str] = Field(None, description="Snapshot date if applicable")

    class Config:
        json_schema_extra = {
            "example": {
                "path": "/project/cil/data/file.txt",
                "size": 1048576,
                "modified_time": "2024-01-15T10:30:00",
                "accessed_time": "2024-01-15T10:30:00",
                "created_time": "2024-01-01T00:00:00",
                "file_type": "txt",
                "inode": 12345678,
                "permissions": 420,
                "parent_path": "/project/cil/data",
                "depth": 3,
                "top_level_dir": "cil",
                "snapshot_date": "2024-01-15"
            }
        }


class FileEntryWithHistory(FileEntry):
    """File entry with historical information."""

    history: list[dict] = Field(default_factory=list, description="Historical snapshots of this file")
    size_change: Optional[int] = Field(None, description="Size change from previous snapshot")
    last_seen: Optional[str] = Field(None, description="Last snapshot where file was seen")
