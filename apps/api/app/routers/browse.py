"""Browse API endpoints for directory navigation."""
from fastapi import APIRouter, HTTPException, Query
from datetime import date
from app.db import execute_query
from app.models import BrowseResponse, DirectoryEntry

router = APIRouter(prefix="/api/browse", tags=["browse"])


@router.get("", response_model=BrowseResponse)
async def browse_folders(
    snapshot_date: date = Query(..., description="Snapshot date"),
    parent_path: str = Query("/", description="Parent directory path"),
    limit: int = Query(1000, ge=1, le=5000, description="Maximum number of folders to return"),
):
    """
    Get child folders for a given parent directory (folders only, no files).

    Uses the directory_hierarchy materialized view for O(1) performance.

    Args:
        snapshot_date: Snapshot date to query
        parent_path: Parent directory path (default: root "/")
        limit: Maximum folders to return

    Returns:
        List of child folders with metadata
    """
    # Normalize parent_path
    if parent_path != "/" and parent_path.endswith("/"):
        parent_path = parent_path.rstrip("/")

    # Query using directory_hierarchy materialized view
    query = """
    SELECT
        child_path AS path,
        name,
        1 AS is_directory,
        total_size AS size,
        formatReadableSize(total_size) AS size_formatted,
        last_modified AS modified_time,
        file_count
    FROM filesystem.directory_hierarchy
    WHERE snapshot_date = %(snapshot_date)s
      AND parent_path = %(parent_path)s
      AND is_directory = 1
    ORDER BY total_size DESC
    LIMIT %(limit)s
    """

    try:
        results = execute_query(
            query,
            {
                "snapshot_date": snapshot_date.isoformat(),
                "parent_path": parent_path,
                "limit": limit,
            },
        )

        # Convert to DirectoryEntry objects
        folders = []
        for row in results:
            folders.append(
                DirectoryEntry(
                    path=row["path"],
                    name=row["name"],
                    is_directory=bool(row["is_directory"]),
                    size=row["size"],
                    size_formatted=row.get("size_formatted"),
                    modified_time=row.get("modified_time"),
                    file_count=row.get("file_count"),
                )
            )

        return BrowseResponse(
            snapshot_date=snapshot_date,
            parent_path=parent_path,
            folders=folders,
            total_count=len(folders),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
