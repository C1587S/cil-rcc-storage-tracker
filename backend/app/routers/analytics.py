"""Analytics router."""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.models.response import HeavyFilesResponse, AnalyticsResponse
from app.database.duckdb_client import DuckDBClient
from app.database.queries import QueryBuilder
from app.services.cache_service import CacheService
from app.utils.validators import validate_date_format, validate_limit
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()


def get_db_client(request: Request) -> DuckDBClient:
    """Dependency to get database client."""
    return request.app.state.db_client


def get_cache() -> CacheService:
    """Dependency to get cache service."""
    return CacheService()


@router.get("/heavy-files", response_model=HeavyFilesResponse)
async def get_heavy_files(
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    limit: Optional[int] = Query(None, description="Maximum files to return"),
    path_filter: Optional[str] = Query(None, description="Path prefix filter"),
    db: DuckDBClient = Depends(get_db_client),
    cache: CacheService = Depends(get_cache)
):
    """
    Get largest files in a snapshot.

    Args:
        snapshot: Snapshot date
        limit: Maximum files to return
        path_filter: Optional path prefix filter

    Returns:
        List of heavy files with statistics
    """
    try:
        settings = get_settings()
        validate_date_format(snapshot)
        limit = validate_limit(
            limit,
            settings.max_heavy_files_limit,
            settings.default_heavy_files_limit
        )

        cache_key = cache.build_key("heavy", snapshot, str(limit), path_filter or "all")

        # Try cache
        cached = await cache.get(cache_key)
        if cached:
            return HeavyFilesResponse(**cached)

        # Query database
        df = db.get_heavy_files(snapshot, limit, path_filter)

        files = df.to_dicts()
        total_size = df["size"].sum() if not df.is_empty() else 0

        response = HeavyFilesResponse(
            files=files,
            total=len(files),
            limit=limit,
            snapshot=snapshot,
            total_size=int(total_size)
        )

        # Cache result
        await cache.set(cache_key, response.model_dump(), ttl=settings.redis_ttl_folders)

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting heavy files: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving heavy files")


@router.get("/inactive-files", response_model=dict)
async def get_inactive_files(
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    days: int = Query(365, description="Days of inactivity threshold", ge=1),
    limit: int = Query(100, description="Maximum files to return", ge=1, le=1000),
    db: DuckDBClient = Depends(get_db_client),
    cache: CacheService = Depends(get_cache)
):
    """
    Get files not accessed in specified number of days.

    Args:
        snapshot: Snapshot date
        days: Days of inactivity threshold
        limit: Maximum files to return

    Returns:
        List of inactive files
    """
    try:
        validate_date_format(snapshot)

        cache_key = cache.build_key("inactive", snapshot, str(days), str(limit))

        # Try cache
        cached = await cache.get(cache_key)
        if cached:
            return cached

        # Query database
        df = db.get_inactive_files(snapshot, days, limit)
        files = df.to_dicts()
        total_size = df["size"].sum() if not df.is_empty() else 0

        result = {
            "files": files,
            "count": len(files),
            "total_size": int(total_size),
            "days_threshold": days,
            "snapshot": snapshot
        }

        # Cache result
        settings = get_settings()
        await cache.set(cache_key, result, ttl=settings.redis_ttl_folders)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting inactive files: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving inactive files")


@router.get("/recent-activity", response_model=dict)
async def get_recent_activity(
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    limit: int = Query(100, description="Maximum files to return", ge=1, le=1000),
    db: DuckDBClient = Depends(get_db_client),
    cache: CacheService = Depends(get_cache)
):
    """
    Get recently modified files.

    Args:
        snapshot: Snapshot date
        limit: Maximum files to return

    Returns:
        List of recently modified files
    """
    try:
        validate_date_format(snapshot)

        cache_key = cache.build_key("recent", snapshot, str(limit))

        # Try cache
        cached = await cache.get(cache_key)
        if cached:
            return cached

        # Query database
        df = db.get_recent_activity(snapshot, limit)
        files = df.to_dicts()

        result = {
            "files": files,
            "count": len(files),
            "snapshot": snapshot
        }

        # Cache result
        settings = get_settings()
        await cache.set(cache_key, result, ttl=settings.redis_ttl_folders)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting recent activity: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving recent activity")


@router.get("/duplicates", response_model=dict)
async def find_duplicate_candidates(
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    min_size: int = Query(1048576, description="Minimum file size (bytes)", ge=0),
    limit: int = Query(100, description="Maximum results", ge=1, le=1000),
    db: DuckDBClient = Depends(get_db_client),
    cache: CacheService = Depends(get_cache)
):
    """
    Find potential duplicate files (same size and type).

    Args:
        snapshot: Snapshot date
        min_size: Minimum file size to consider
        limit: Maximum results

    Returns:
        List of potential duplicate file groups
    """
    try:
        validate_date_format(snapshot)

        cache_key = cache.build_key("duplicates", snapshot, str(min_size), str(limit))

        # Try cache
        cached = await cache.get(cache_key)
        if cached:
            return cached

        # Build and execute query
        query_builder = QueryBuilder()
        query = query_builder.build_duplicate_candidates_query(snapshot, min_size, limit)
        df = db.execute_raw_query(query)

        candidates = df.to_dicts()
        total_wasted = df["wasted_space"].sum() if not df.is_empty() else 0

        result = {
            "candidates": candidates,
            "count": len(candidates),
            "total_wasted_space": int(total_wasted),
            "min_size": min_size,
            "snapshot": snapshot
        }

        # Cache result
        settings = get_settings()
        await cache.set(cache_key, result, ttl=settings.redis_ttl_folders)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error finding duplicates: {e}")
        raise HTTPException(status_code=500, detail="Error finding duplicate candidates")


@router.get("/growth", response_model=dict)
async def analyze_growth(
    from_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    to_date: str = Query(..., description="End date (YYYY-MM-DD)"),
    group_by: str = Query("top_level_dir", description="Group by dimension"),
    db: DuckDBClient = Depends(get_db_client),
    cache: CacheService = Depends(get_cache)
):
    """
    Analyze storage growth between two snapshots.

    Args:
        from_date: Start date
        to_date: End date
        group_by: Group dimension ('top_level_dir' or 'file_type')

    Returns:
        Growth analysis data
    """
    try:
        validate_date_format(from_date)
        validate_date_format(to_date)

        if group_by not in ["top_level_dir", "file_type"]:
            raise HTTPException(
                status_code=400,
                detail="group_by must be 'top_level_dir' or 'file_type'"
            )

        cache_key = cache.build_key("growth", from_date, to_date, group_by)

        # Try cache
        cached = await cache.get(cache_key)
        if cached:
            return cached

        # Build and execute query
        query_builder = QueryBuilder()
        query = query_builder.build_growth_analysis_query(from_date, to_date, group_by)
        df = db.execute_raw_query(query)

        growth_data = df.to_dicts()

        result = {
            "from_date": from_date,
            "to_date": to_date,
            "group_by": group_by,
            "data": growth_data
        }

        # Cache result
        settings = get_settings()
        await cache.set(cache_key, result, ttl=settings.redis_ttl_snapshots)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing growth: {e}")
        raise HTTPException(status_code=500, detail="Error analyzing growth")


@router.get("/distribution", response_model=dict)
async def get_distribution(
    snapshot: str = Query(..., description="Snapshot date (YYYY-MM-DD)"),
    dimension: str = Query("type", description="Dimension to analyze"),
    limit: int = Query(20, description="Maximum categories", ge=1, le=100),
    db: DuckDBClient = Depends(get_db_client),
    cache: CacheService = Depends(get_cache)
):
    """
    Get distribution analysis by various dimensions.

    Args:
        snapshot: Snapshot date
        dimension: Dimension ('type', 'size_bucket', 'depth')
        limit: Maximum categories to return

    Returns:
        Distribution data
    """
    try:
        validate_date_format(snapshot)

        if dimension not in ["type", "size_bucket", "depth"]:
            raise HTTPException(
                status_code=400,
                detail="dimension must be 'type', 'size_bucket', or 'depth'"
            )

        cache_key = cache.build_key("distribution", snapshot, dimension, str(limit))

        # Try cache
        cached = await cache.get(cache_key)
        if cached:
            return cached

        # Build and execute query
        query_builder = QueryBuilder()
        query = query_builder.build_distribution_query(snapshot, dimension, limit)
        df = db.execute_raw_query(query)

        distribution = df.to_dicts()

        result = {
            "snapshot": snapshot,
            "dimension": dimension,
            "data": distribution
        }

        # Cache result
        settings = get_settings()
        await cache.set(cache_key, result, ttl=settings.redis_ttl_folders)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting distribution: {e}")
        raise HTTPException(status_code=500, detail="Error analyzing distribution")
