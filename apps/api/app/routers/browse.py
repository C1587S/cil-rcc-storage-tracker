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

    # Query using directory_hierarchy with directory_sizes for aggregated totals
    # directory_sizes contains sum of direct children only (not recursive)
    # For truly recursive sizes, query entries directly with path prefix match
    query = """
    SELECT
        h.child_path AS path,
        h.name,
        1 AS is_directory,
        COALESCE(ds.total_size, 0) AS size,
        formatReadableSize(COALESCE(ds.total_size, 0)) AS size_formatted,
        h.last_modified AS modified_time,
        COALESCE(ds.file_count, 0) AS file_count
    FROM filesystem.directory_hierarchy AS h
    LEFT JOIN (
        SELECT path, sum(total_size) AS total_size, sum(file_count) AS file_count
        FROM filesystem.directory_sizes
        WHERE snapshot_date = %(snapshot_date)s
        GROUP BY path
    ) AS ds ON ds.path = h.child_path
    WHERE h.snapshot_date = %(snapshot_date)s
      AND h.parent_path = %(parent_path)s
      AND h.is_directory = 1
    ORDER BY size DESC
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
