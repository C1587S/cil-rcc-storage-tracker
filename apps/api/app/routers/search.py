"""Search API endpoints."""
from fastapi import APIRouter, HTTPException, Query
from datetime import date
from typing import Literal
from app.db import execute_query
from app.models import SearchResponse, DirectoryEntry
from app.services.guardrails import validate_scope_path, QueryValidationError

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=SearchResponse)
async def search_files(
    snapshot_date: date = Query(..., description="Snapshot date"),
    q: str = Query(..., min_length=1, description="Search query"),
    mode: Literal["exact", "contains", "prefix", "suffix"] = Query("contains", description="Search mode"),
    scope_path: str | None = Query(None, description="Limit search to this directory subtree"),
    include_files: bool = Query(True, description="Include files in results"),
    include_dirs: bool = Query(True, description="Include directories in results"),
    limit: int = Query(100, ge=1, le=5000, description="Maximum results to return"),
):
    """
    Search for files and directories by name.

    Search modes:
    - exact: Exact name match
    - contains: Name contains substring (case-insensitive)
    - prefix: Name starts with prefix
    - suffix: Name ends with suffix

    Args:
        snapshot_date: Snapshot date to query
        q: Search query string
        mode: Search mode (exact, contains, prefix, suffix)
        scope_path: Optional path to limit search scope
        include_files: Include files in results
        include_dirs: Include directories in results
        limit: Maximum results to return

    Returns:
        List of matching entries
    """
    # Build type filter
    type_conditions = []
    if include_files and not include_dirs:
        type_conditions.append("is_directory = 0")
    elif include_dirs and not include_files:
        type_conditions.append("is_directory = 1")
    # If both or neither, no filter needed

    type_filter = f"AND ({' OR '.join(type_conditions)})" if type_conditions else ""

    # Build scope filter
    scope_filter = ""
    params = {
        "snapshot_date": snapshot_date.isoformat(),
        "q": q,
        "limit": limit,
    }

    if scope_path:
        try:
            scope_path = validate_scope_path(scope_path)
            if scope_path == "/":
                # No scope filter needed for root
                pass
            else:
                scope_filter = "AND (parent_path = %(scope_path)s OR parent_path LIKE concat(%(scope_path)s, '/%'))"
                params["scope_path"] = scope_path
        except QueryValidationError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Build name condition based on mode
    if mode == "exact":
        name_condition = "name = %(q)s"
    elif mode == "contains":
        name_condition = "positionCaseInsensitive(name, %(q)s) > 0"
    elif mode == "prefix":
        name_condition = "startsWith(name, %(q)s)"
    elif mode == "suffix":
        name_condition = "endsWith(name, %(q)s)"
    else:
        raise HTTPException(status_code=400, detail=f"Invalid search mode: {mode}")

    # Build query
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
      AND {name_condition}
      {type_filter}
      {scope_filter}
    ORDER BY size DESC
    LIMIT %(limit)s
    """

    try:
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

        return SearchResponse(
            snapshot_date=snapshot_date,
            query=q,
            mode=mode,
            results=entries,
            total_count=len(entries),
            limit=limit,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
