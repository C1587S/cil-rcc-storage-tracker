"""Voronoi artifact API endpoints."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from datetime import date
from app.services.snapshot_storage import SnapshotStorage

router = APIRouter(prefix="/api/voronoi", tags=["voronoi"])
storage = SnapshotStorage()


@router.get("/artifact/{snapshot_date}")
async def get_voronoi_artifact(
    snapshot_date: date,
    path: str = Query("/project/cil", description="Root path filter (for future use)"),
):
    """
    Get precomputed voronoi artifact for a snapshot.

    This endpoint serves the precomputed voronoi.json artifact from disk,
    which contains the complete hierarchical voronoi data structure.

    Args:
        snapshot_date: Snapshot date to retrieve
        path: Root path (currently unused, reserved for future filtering)

    Returns:
        Voronoi artifact JSON

    Raises:
        404: If artifact not found for the given snapshot
        500: If artifact loading fails
    """
    try:
        artifact = storage.load_voronoi_artifact(snapshot_date)

        if artifact is None:
            raise HTTPException(
                status_code=404,
                detail=f"Voronoi artifact not found for snapshot {snapshot_date}. "
                "Run compute_voronoi.py to generate it.",
            )

        return JSONResponse(content=artifact)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load voronoi artifact: {str(e)}"
        )


@router.get("/artifact/{snapshot_date}/stats")
async def get_artifact_stats(snapshot_date: date):
    """
    Get statistics about a voronoi artifact.

    Args:
        snapshot_date: Snapshot date to query

    Returns:
        Statistics about the artifact (size, node count, etc.)

    Raises:
        404: If artifact not found
    """
    try:
        stats = storage.get_artifact_stats(snapshot_date)

        if stats is None:
            raise HTTPException(
                status_code=404,
                detail=f"Voronoi artifact not found for snapshot {snapshot_date}",
            )

        return stats

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get artifact stats: {str(e)}"
        )


@router.get("/artifacts")
async def list_artifacts():
    """
    List all available voronoi artifacts.

    Returns:
        List of snapshot dates with available artifacts
    """
    try:
        snapshot_dates = storage.list_snapshots()
        artifacts = []

        for snapshot_str in snapshot_dates:
            snapshot_date = date.fromisoformat(snapshot_str)
            if storage.artifact_exists(snapshot_date):
                stats = storage.get_artifact_stats(snapshot_date)
                artifacts.append(
                    {
                        "snapshot_date": snapshot_str,
                        "artifact_exists": True,
                        "stats": stats,
                    }
                )

        return {"total": len(artifacts), "artifacts": artifacts}

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list artifacts: {str(e)}"
        )
