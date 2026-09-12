"""Browse API endpoints for directory navigation."""
from fastapi import APIRouter, HTTPException, Query, Response
from datetime import date
from app.db import execute_query
from app.cache import LRUCache
from app.models import BrowseResponse, DirectoryEntry

router = APIRouter(prefix="/api/browse", tags=["browse"])

_cache = LRUCache(maxsize=2048)


@router.get("", response_model=BrowseResponse)
async def browse_folders(
    response: Response,
    snapshot_date: date = Query(..., description="Snapshot date"),
    parent_path: str = Query("/", description="Parent directory path"),
    limit: int = Query(1000, ge=1, le=8000, description="Maximum number of folders to return"),
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

    # Snapshot data is immutable: serve from cache when possible
    response.headers["Cache-Control"] = "public, max-age=300"
    cache_key = (snapshot_date.isoformat(), parent_path, limit)
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    # Query directory_hierarchy joined with directory_recursive_sizes for true
    # recursive totals. The join side is pre-filtered to only this directory's
    # children so the join hash table stays tiny instead of covering the table.
    query = """
    SELECT DISTINCT
        h.child_path AS path,
        h.name AS name,
        1 AS is_directory,
        COALESCE(rs.recursive_size_bytes, 0) AS recursive_size,
        formatReadableSize(COALESCE(rs.recursive_size_bytes, 0)) AS recursive_size_formatted,
        COALESCE(rs.direct_size_bytes, 0) AS size,
        formatReadableSize(COALESCE(rs.direct_size_bytes, 0)) AS size_formatted,
        h.last_modified AS modified_time,
        COALESCE(rs.recursive_file_count, 0) AS file_count,
        COALESCE(rs.recursive_dir_count, 0) AS dir_count,
        COALESCE(rs.direct_file_count, 0) AS direct_file_count,
        COALESCE(ds.direct_dir_count, 0) AS direct_dir_count
    FROM filesystem.directory_hierarchy AS h
    LEFT JOIN (
        SELECT path, recursive_size_bytes, direct_size_bytes,
               direct_file_count, recursive_file_count, recursive_dir_count
        FROM filesystem.directory_recursive_sizes
        WHERE snapshot_date = %(snapshot_date)s
          AND path IN (
              SELECT child_path FROM filesystem.directory_hierarchy
              WHERE snapshot_date = %(snapshot_date)s
                AND parent_path = %(parent_path)s
                AND is_directory = 1
          )
    ) AS rs ON rs.path = h.child_path
    LEFT JOIN (
        SELECT path AS agg_path, sum(dir_count) AS direct_dir_count
        FROM filesystem.directory_sizes
        WHERE snapshot_date = %(snapshot_date)s
          AND path IN (
              SELECT child_path FROM filesystem.directory_hierarchy
              WHERE snapshot_date = %(snapshot_date)s
                AND parent_path = %(parent_path)s
                AND is_directory = 1
          )
        GROUP BY agg_path
    ) AS ds ON ds.agg_path = h.child_path
    WHERE h.snapshot_date = %(snapshot_date)s
      AND h.parent_path = %(parent_path)s
      AND h.is_directory = 1
    ORDER BY recursive_size DESC
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
                    recursive_size=row.get("recursive_size"),
                    recursive_size_formatted=row.get("recursive_size_formatted"),
                    modified_time=row.get("modified_time"),
                    file_count=row.get("file_count"),
                    dir_count=row.get("dir_count"),
                    direct_file_count=row.get("direct_file_count"),
                    direct_dir_count=row.get("direct_dir_count"),
                )
            )

        result = BrowseResponse(
            snapshot_date=snapshot_date,
            parent_path=parent_path,
            folders=folders,
            total_count=len(folders),
        )
        _cache.put(cache_key, result)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
