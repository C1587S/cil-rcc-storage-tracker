"""Search router."""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.models.response import SearchResponse
from app.models.file_entry import FileEntry
from app.services.search_service import SearchService
from app.services.cache_service import CacheService
from app.utils.validators import sanitize_pattern, validate_limit
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()


def get_search_service(request: Request) -> SearchService:
    """Dependency to get search service."""
    db_client = request.app.state.db_client
    cache = CacheService()
    return SearchService(db_client, cache)


@router.get("/", response_model=SearchResponse)
async def search_files(
    q: str = Query(..., description="Search pattern (glob or regex)"),
    snapshot: Optional[str] = Query(None, description="Snapshot date (YYYY-MM-DD)"),
    regex: bool = Query(True, description="Use regex matching (false for glob)"),
    limit: Optional[int] = Query(None, description="Maximum results to return"),
    offset: int = Query(0, description="Result offset for pagination", ge=0),
    service: SearchService = Depends(get_search_service)
):
    """
    Search for files matching a pattern.

    Args:
        q: Search pattern (glob or regex)
        snapshot: Specific snapshot to search (None for latest)
        regex: Use regex matching (False for glob/wildcard)
        limit: Maximum results to return
        offset: Result offset for pagination

    Returns:
        Search results with matching files
    """
    try:
        settings = get_settings()

        # Sanitize and validate inputs
        pattern = sanitize_pattern(q, regex=regex)
        limit = validate_limit(limit, settings.max_search_limit, settings.default_search_limit)

        # Execute search
        results = await service.search_files(
            pattern=pattern,
            snapshot=snapshot,
            regex=regex,
            limit=limit,
            offset=offset
        )

        return results

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in search endpoint: {e}")
        raise HTTPException(status_code=500, detail="Error executing search")


@router.get("/history", response_model=dict)
async def get_file_history(
    path: str = Query(..., description="Full file path"),
    service: SearchService = Depends(get_search_service)
):
    """
    Get history of a specific file across snapshots.

    Args:
        path: Full file path

    Returns:
        File history across all snapshots
    """
    try:
        history = await service.get_file_history(path)

        return {
            "path": path,
            "history": history,
            "snapshot_count": len(history)
        }

    except Exception as e:
        logger.error(f"Error getting file history: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving file history")


@router.post("/advanced", response_model=list[FileEntry])
async def advanced_search(
    path_pattern: Optional[str] = None,
    file_types: Optional[list[str]] = None,
    min_size: Optional[int] = None,
    max_size: Optional[int] = None,
    modified_after: Optional[str] = None,
    modified_before: Optional[str] = None,
    snapshot: Optional[str] = None,
    limit: int = 100,
    service: SearchService = Depends(get_search_service)
):
    """
    Advanced search with multiple filters.

    Args:
        path_pattern: Path pattern to match
        file_types: List of file extensions
        min_size: Minimum file size in bytes
        max_size: Maximum file size in bytes
        modified_after: Modified after date (YYYY-MM-DD)
        modified_before: Modified before date (YYYY-MM-DD)
        snapshot: Snapshot date
        limit: Maximum results

    Returns:
        List of matching files
    """
    try:
        results = await service.search_advanced(
            path_pattern=path_pattern,
            file_types=file_types,
            min_size=min_size,
            max_size=max_size,
            modified_after=modified_after,
            modified_before=modified_before,
            snapshot=snapshot,
            limit=limit
        )

        return results

    except Exception as e:
        logger.error(f"Error in advanced search: {e}")
        raise HTTPException(status_code=500, detail="Error executing advanced search")
