"""Snapshots API endpoints."""
from fastapi import APIRouter, HTTPException
from app.db import execute_query
from app.models import SnapshotInfo

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@router.get("", response_model=list[SnapshotInfo])
async def list_snapshots():
    """
    List all available snapshots with metadata.

    Returns snapshots in descending order by date (newest first).
    """
    query = """
    SELECT
        snapshot_date,
        total_entries,
        total_size,
        total_files,
        total_directories,
        scan_started,
        scan_completed,
        top_level_dirs,
        import_time
    FROM filesystem.snapshots
    ORDER BY snapshot_date DESC
    """

    try:
        results = execute_query(query)
        return [SnapshotInfo(**row) for row in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{snapshot_date}", response_model=SnapshotInfo)
async def get_snapshot(snapshot_date: str):
    """
    Get metadata for a specific snapshot.

    Args:
        snapshot_date: Snapshot date in YYYY-MM-DD format
    """
    query = """
    SELECT
        snapshot_date,
        total_entries,
        total_size,
        total_files,
        total_directories,
        scan_started,
        scan_completed,
        top_level_dirs,
        import_time
    FROM filesystem.snapshots
    WHERE snapshot_date = %(snapshot_date)s
    """

    try:
        results = execute_query(query, {"snapshot_date": snapshot_date})

        if not results:
            raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_date} not found")

        return SnapshotInfo(**results[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
