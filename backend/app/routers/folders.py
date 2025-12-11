"""Folder analysis router."""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Path, Request
from urllib.parse import unquote

from app.models.response import FolderBreakdown, FolderTree
from app.services.folder_service import FolderService
from app.services.cache_service import CacheService
from app.utils.validators import validate_path, validate_depth, validate_date_format

logger = logging.getLogger(__name__)
router = APIRouter()


def get_folder_service(request: Request) -> FolderService:
    """Dependency to get folder service."""
    db_client = request.app.state.db_client
    cache = CacheService()
    return FolderService(db_client, cache)


@router.get("/tree", response_model=dict)
async def get_folder_tree_root(
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    path: str = Query("/", description="Root path (defaults to /)"),
    max_depth: int = Query(3, description="Maximum tree depth", ge=1, le=5),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get hierarchical folder tree structure.

    This endpoint uses query parameters to avoid path conflicts.
    Use this for the root path (/) or any path specified as a query param.

    Args:
        snapshot: Snapshot date
        path: Root path (defaults to /)
        max_depth: Maximum depth of tree

    Returns:
        Hierarchical folder tree node as dict
    """
    try:
        logger.info(f"[/tree endpoint] Received path='{path}', snapshot={snapshot}, max_depth={max_depth}")

        if path != "/":
            path = validate_path(path)
        validate_date_format(snapshot)

        logger.info(f"[/tree endpoint] After validation, path='{path}'")

        if max_depth > 5:
            raise HTTPException(
                status_code=400,
                detail="max_depth cannot exceed 5 (performance limitation)"
            )

        tree = await service.get_folder_tree(
            path=path,
            snapshot=snapshot,
            max_depth=max_depth
        )

        logger.info(f"[/tree endpoint] Service returned: name='{tree.root.name}', path='{tree.root.path}', children={len(tree.root.children)}")

        # Return the root node directly as a dict for visualization
        result = tree.root.model_dump()
        logger.info(f"[/tree endpoint] Returning: name='{result.get('name')}', path='{result.get('path')}', children count={len(result.get('children', []))}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting folder tree: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error building folder tree")


@router.get("/{path:path}", response_model=FolderBreakdown)
async def get_folder_breakdown(
    path: str = Path(..., description="Folder path to analyze"),
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    depth: int = Query(1, description="Analysis depth", ge=1, le=10),
    group_by: str = Query("directory", description="Group by 'directory' or 'type'"),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get folder breakdown with size information.

    Args:
        path: Folder path to analyze
        snapshot: Snapshot date
        depth: Directory depth to analyze
        group_by: Group by 'directory' or 'type'

    Returns:
        Folder breakdown with items and statistics
    """
    try:
        # Decode and validate path
        path = unquote(path)
        path = validate_path(path)
        validate_date_format(snapshot)
        depth = validate_depth(depth)

        if group_by not in ["directory", "type"]:
            raise HTTPException(
                status_code=400,
                detail="group_by must be 'directory' or 'type'"
            )

        breakdown = await service.get_folder_breakdown(
            path=path,
            snapshot=snapshot,
            depth=depth,
            group_by=group_by
        )

        return breakdown

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting folder breakdown: {e}")
        raise HTTPException(status_code=500, detail="Error analyzing folder")


@router.get("/{path:path}/tree", response_model=dict)
async def get_folder_tree(
    path: str = Path(..., description="Root path for tree"),
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    max_depth: int = Query(3, description="Maximum tree depth", ge=1, le=5),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get hierarchical folder tree structure.

    Args:
        path: Root path from URL (use 'tree' for root /)
        snapshot: Snapshot date
        max_depth: Maximum depth of tree

    Returns:
        Hierarchical folder tree node as dict
    """
    try:
        path = unquote(path) if path else "tree"
        logger.info(f"[tree endpoint] Raw path from URL: '{path}', snapshot={snapshot}, max_depth={max_depth}")

        # Special case: if path is "tree", treat it as root "/"
        # This is because /api/folders/tree maps to path="tree"
        if path == "tree" or not path or path == "":
            path = "/"
            logger.info(f"[tree endpoint] Detected root request, using path='/'")
        else:
            # Validate non-root paths
            path = validate_path(path)
            logger.info(f"[tree endpoint] After validation, path='{path}'")

        validate_date_format(snapshot)

        if max_depth > 5:
            raise HTTPException(
                status_code=400,
                detail="max_depth cannot exceed 5 (performance limitation)"
            )

        tree = await service.get_folder_tree(
            path=path,
            snapshot=snapshot,
            max_depth=max_depth
        )

        logger.info(f"[tree endpoint] Service returned: name='{tree.root.name}', path='{tree.root.path}', children={len(tree.root.children)}")

        # Return the root node directly as a dict for visualization
        result = tree.root.model_dump()
        logger.info(f"[tree endpoint] Returning: name='{result.get('name')}', path='{result.get('path')}', children count={len(result.get('children', []))}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting folder tree: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error building folder tree")


@router.get("/{path:path}/timeline", response_model=dict)
async def get_folder_timeline(
    path: str = Path(..., description="Folder path"),
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    metric: str = Query("size", description="Metric to track (size, count, types)"),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get folder size/count over time.

    Args:
        path: Folder path
        start_date: Start date
        end_date: End date
        metric: Metric to track ('size', 'count', 'types')

    Returns:
        Timeline data points
    """
    try:
        path = unquote(path)
        path = validate_path(path)
        validate_date_format(start_date)
        validate_date_format(end_date)

        if metric not in ["size", "count", "types"]:
            raise HTTPException(
                status_code=400,
                detail="metric must be 'size', 'count', or 'types'"
            )

        timeline = await service.get_folder_timeline(
            path=path,
            start_date=start_date,
            end_date=end_date,
            metric=metric
        )

        return {
            "path": path,
            "start_date": start_date,
            "end_date": end_date,
            "metric": metric,
            "data": timeline
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting folder timeline: {e}")
        raise HTTPException(status_code=500, detail="Error generating timeline")


@router.get("/{path:path}/types", response_model=dict)
async def get_type_distribution(
    path: str = Path(..., description="Folder path"),
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    service: FolderService = Depends(get_folder_service)
):
    """
    Get file type distribution for a folder.

    Args:
        path: Folder path
        snapshot: Snapshot date

    Returns:
        File type distribution
    """
    try:
        path = unquote(path)
        path = validate_path(path)
        validate_date_format(snapshot)

        distribution = await service.get_type_distribution(
            path=path,
            snapshot=snapshot
        )

        return {
            "path": path,
            "snapshot": snapshot,
            "distribution": distribution
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting type distribution: {e}")
        raise HTTPException(status_code=500, detail="Error analyzing file types")
