"""Snapshot management router."""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request

from app.models.snapshot import Snapshot, SnapshotInfo, SnapshotComparison
from app.services.snapshot_service import SnapshotService
from app.services.cache_service import CacheService
from app.utils.validators import validate_date_format

logger = logging.getLogger(__name__)
router = APIRouter()


def get_snapshot_service(request: Request) -> SnapshotService:
    """Dependency to get snapshot service."""
    db_client = request.app.state.db_client
    cache = CacheService()
    return SnapshotService(db_client, cache)


@router.get("/", response_model=dict)
async def list_snapshots(
    service: SnapshotService = Depends(get_snapshot_service)
):
    """
    List all available snapshots.

    Returns:
        Dictionary with snapshots list
    """
    try:
        snapshots = await service.list_snapshots()
        return {
            "snapshots": [s.model_dump() for s in snapshots],
            "count": len(snapshots)
        }
    except Exception as e:
        logger.error(f"Error listing snapshots: {e}")
        raise HTTPException(status_code=500, detail="Error listing snapshots")


@router.get("/latest", response_model=Snapshot)
async def get_latest_snapshot(
    service: SnapshotService = Depends(get_snapshot_service)
):
    """
    Get the most recent snapshot.

    Returns:
        Latest snapshot information
    """
    try:
        snapshot = await service.get_latest_snapshot()
        if not snapshot:
            raise HTTPException(status_code=404, detail="No snapshots found")
        return snapshot
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting latest snapshot: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving latest snapshot")


@router.get("/{date}", response_model=SnapshotInfo)
async def get_snapshot(
    date: str,
    service: SnapshotService = Depends(get_snapshot_service)
):
    """
    Get detailed information about a specific snapshot.

    Args:
        date: Snapshot date (YYYY-MM-DD)

    Returns:
        Detailed snapshot information
    """
    try:
        validate_date_format(date)
        snapshot = await service.get_snapshot(date)

        if not snapshot:
            raise HTTPException(
                status_code=404,
                detail=f"Snapshot not found for date: {date}"
            )

        return snapshot
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting snapshot {date}: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving snapshot")


@router.get("/compare/", response_model=SnapshotComparison)
async def compare_snapshots(
    from_date: str,
    to_date: str,
    service: SnapshotService = Depends(get_snapshot_service)
):
    """
    Compare two snapshots to see changes.

    Args:
        from_date: Earlier snapshot date (YYYY-MM-DD)
        to_date: Later snapshot date (YYYY-MM-DD)

    Returns:
        Snapshot comparison with changes
    """
    try:
        validate_date_format(from_date)
        validate_date_format(to_date)

        comparison = await service.compare_snapshots(from_date, to_date)

        if not comparison:
            raise HTTPException(
                status_code=404,
                detail=f"Could not compare snapshots: {from_date} and {to_date}"
            )

        return comparison
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error comparing snapshots: {e}")
        raise HTTPException(status_code=500, detail="Error comparing snapshots")
