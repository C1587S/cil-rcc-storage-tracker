"""Contents API endpoints for directory contents (folders + files)."""
from fastapi import APIRouter, HTTPException, Query
from datetime import date
from typing import Literal
from app.db import execute_query
from app.models import ContentsResponse, DirectoryEntry

router = APIRouter(prefix="/api/contents", tags=["contents"])


@router.get("", response_model=ContentsResponse)
async def get_contents(
    snapshot_date: date = Query(..., description="Snapshot date"),
    parent_path: str = Query("/", description="Parent directory path"),
    limit: int = Query(100, ge=1, le=5000, description="Maximum entries to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    sort: Literal["size_desc", "size_asc", "name_asc", "name_desc", "modified_desc"] = Query(
        "size_desc", description="Sort order"
    ),
    filter_type: Literal["all", "files", "folders"] | None = Query(None, description="Filter by type"),
):
    """
    Get directory contents (both folders and files) with pagination and sorting.

    Args:
        snapshot_date: Snapshot date to query
        parent_path: Parent directory path
        limit: Maximum entries to return
        offset: Offset for pagination
        sort: Sort order (size_desc, size_asc, name_asc, name_desc, modified_desc)
        filter_type: Filter by type (all, files, folders)

    Returns:
        Paginated list of directory entries
    """
    # Normalize parent_path
    if parent_path != "/" and parent_path.endswith("/"):
        parent_path = parent_path.rstrip("/")

    # Build ORDER BY clause
    order_by_map = {
        "size_desc": "size DESC",
        "size_asc": "size ASC",
        "name_asc": "name ASC",
        "name_desc": "name DESC",
        "modified_desc": "modified_time DESC",
    }
    order_by = order_by_map.get(sort, "size DESC")

    # Build WHERE clause for type filter
    type_filter = ""
    if filter_type == "files":
        type_filter = "AND is_directory = 0"
    elif filter_type == "folders":
        type_filter = "AND is_directory = 1"

    # Query filesystem.entries for detailed information
    query = f"""
    SELECT
        path,
        name,
        is_directory,
        size,
        formatReadableSize(size) AS size_formatted,
        owner,
        file_type,
        modified_time,
        accessed_time
    FROM filesystem.entries
    WHERE snapshot_date = %(snapshot_date)s
      AND parent_path = %(parent_path)s
      {type_filter}
    ORDER BY {order_by}
    LIMIT %(limit)s
    OFFSET %(offset)s
    """

    # Count query for total entries
    count_query = f"""
    SELECT count() AS total
    FROM filesystem.entries
    WHERE snapshot_date = %(snapshot_date)s
      AND parent_path = %(parent_path)s
      {type_filter}
    """

    try:
        params = {
            "snapshot_date": snapshot_date.isoformat(),
            "parent_path": parent_path,
            "limit": limit,
            "offset": offset,
        }

        # Get total count
        count_result = execute_query(count_query, params)
        total_count = count_result[0]["total"] if count_result else 0

        # Get entries
        results = execute_query(query, params)

        # Convert to DirectoryEntry objects
        entries = []
        for row in results:
            entries.append(
                DirectoryEntry(
                    path=row["path"],
                    name=row["name"],
                    is_directory=bool(row["is_directory"]),
                    size=row["size"],
                    size_formatted=row.get("size_formatted"),
                    owner=row.get("owner"),
                    file_type=row.get("file_type"),
                    modified_time=row.get("modified_time"),
                    accessed_time=row.get("accessed_time"),
                )
            )

        return ContentsResponse(
            snapshot_date=snapshot_date,
            parent_path=parent_path,
            entries=entries,
            total_count=total_count,
            offset=offset,
            limit=limit,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
