"""Visualization data router."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from urllib.parse import unquote

from app.services.folder_service import FolderService
from app.services.cache_service import CacheService
from app.utils.validators import validate_path, validate_date_format

logger = logging.getLogger(__name__)
router = APIRouter()


def get_folder_service(request: Request) -> FolderService:
    """Dependency to get folder service."""
    db_client = request.app.state.db_client
    cache = CacheService()
    return FolderService(db_client, cache)


@router.get("/treemap")
async def get_treemap_data(
    path: str = Query("/", description="Root path for treemap"),
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    depth: int = Query(2, description="Maximum depth", ge=1, le=5),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get treemap visualization data.

    Args:
        path: Root path
        snapshot: Snapshot date
        depth: Maximum depth

    Returns:
        Treemap data structure
    """
    try:
        path = unquote(path) if path != "/" else "/"
        if path != "/":
            path = validate_path(path)
        validate_date_format(snapshot)

        logger.info(f"Getting treemap data for path={path}, snapshot={snapshot}, depth={depth}")

        # Get folder breakdown
        breakdown = await service.get_folder_breakdown(
            path=path,
            snapshot=snapshot,
            depth=depth,
            group_by="directory"
        )

        # Convert to treemap format
        treemap_data = {
            "name": path if path != "/" else "Root",
            "path": path,
            "size": breakdown.total_size,
            "children": [
                {
                    "name": item.name,
                    "path": item.path,
                    "size": item.size,
                    "percentage": item.percentage,
                }
                for item in breakdown.children
            ]
        }

        return treemap_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting treemap data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error generating treemap data")


@router.get("/disk-usage")
async def get_disk_usage_data(
    path: str = Query("/", description="Root path"),
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    limit: int = Query(20, description="Maximum items to return", ge=1, le=100),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get disk usage tree data (dutree-style).

    Args:
        path: Root path
        snapshot: Snapshot date
        limit: Maximum number of items

    Returns:
        Disk usage data with size bars
    """
    try:
        path = unquote(path) if path != "/" else "/"
        if path != "/":
            path = validate_path(path)
        validate_date_format(snapshot)

        logger.info(f"Getting disk usage data for path={path}, snapshot={snapshot}")

        # Get folder breakdown
        breakdown = await service.get_folder_breakdown(
            path=path,
            snapshot=snapshot,
            depth=1,
            group_by="directory"
        )

        # Sort by size and limit
        items = sorted(breakdown.children, key=lambda x: x.size, reverse=True)[:limit]

        # Convert to disk usage format
        disk_usage_data = [
            {
                "name": item.name,
                "path": item.path,
                "size": item.size,
                "percentage": item.percentage,
                "file_count": item.file_count,
                "prefix": "├── ",
                "depth": 1
            }
            for item in items
        ]

        return {
            "path": path,
            "total_size": breakdown.total_size,
            "items": disk_usage_data
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting disk usage data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error generating disk usage data")
