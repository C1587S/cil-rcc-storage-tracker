"""Voronoi artifact API endpoints."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from datetime import date
from app.services.snapshot_storage import SnapshotStorage
from app.services.voronoi_store import VoronoiStore

router = APIRouter(prefix="/api/voronoi", tags=["voronoi"])
storage = SnapshotStorage()
voronoi_store = VoronoiStore()


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


@router.get("/node/{snapshot_date}/batch")
async def get_voronoi_nodes_batch(
    snapshot_date: date,
    node_ids: str = Query(..., description="Comma-separated list of node IDs"),
):
    """
    Batch fetch multiple voronoi nodes by IDs for performance.

    This endpoint allows fetching multiple nodes in a single HTTP request,
    reducing latency when expanding preview depth.

    Args:
        snapshot_date: Snapshot date
        node_ids: Comma-separated node IDs (e.g., "id1,id2,id3")

    Returns:
        Dictionary mapping node_id -> node_data:
        {
            "id1": { "node_id": "id1", "name": "...", ... },
            "id2": { "node_id": "id2", "name": "...", ... },
            ...
        }

    Raises:
        400: If node_ids is empty or invalid
        500: If retrieval fails
    """
    try:
        if not node_ids:
            raise HTTPException(status_code=400, detail="node_ids parameter is required")

        ids = [id.strip() for id in node_ids.split(",") if id.strip()]
        if not ids:
            raise HTTPException(status_code=400, detail="No valid node IDs provided")

        # Fetch all nodes in parallel (ClickHouse is fast enough for this)
        results = {}
        for node_id in ids:
            node_data = voronoi_store.get_node(snapshot_date, node_id)
            if node_data:
                results[node_id] = node_data

        return JSONResponse(content=results)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve voronoi nodes: {str(e)}",
        )


@router.get("/node/{snapshot_date}/subtree")
async def get_voronoi_subtree(
    snapshot_date: date,
    path: str = Query(..., description="Root path of subtree to fetch"),
    max_depth: int = Query(2, description="Maximum depth relative to root"),
):
    """
    Fetch an entire subtree in a single request for maximum performance.

    This endpoint is optimized for the precomputed voronoi workflow where we want
    to fetch a node + all its descendants up to a certain depth in one query.

    Args:
        snapshot_date: Snapshot date
        path: Root path of the subtree (e.g., "/project/cil/gcp")
        max_depth: Maximum relative depth to fetch (default 2 for preview depth)

    Returns:
        Dictionary mapping node_id -> node_data for all nodes in the subtree:
        {
            "d_123_1": { "node_id": "d_123_1", "path": "/project/cil/gcp", ... },
            "d_456_2": { "node_id": "d_456_2", "path": "/project/cil/gcp/agriculture", ... },
            ...
        }

    Raises:
        404: If root node not found
        500: If retrieval fails
    """
    try:
        # OPTIMIZED: Use single SQL query instead of N+1 recursive fetches
        results = voronoi_store.get_subtree(snapshot_date, path, max_depth)

        if not results:
            raise HTTPException(
                status_code=404,
                detail=f"No node found at path {path} for snapshot {snapshot_date}",
            )

        return JSONResponse(content=results)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve voronoi subtree: {str(e)}",
        )


@router.get("/node/{snapshot_date}/{node_id}")
async def get_voronoi_node(snapshot_date: date, node_id: str, path: str = None):
    """
    Get a single voronoi node by ID or path for incremental loading.

    This endpoint enables KB-level browser downloads instead of GB-level artifacts.
    The frontend fetches nodes on-demand as the user drills down.

    Special node_id values:
    - "root": Returns the root node (depth=0) for the snapshot
    - "by-path": Lookup by path query parameter instead of node_id

    Args:
        snapshot_date: Snapshot date
        node_id: Node ID to retrieve, "root" for root, or "by-path" for path lookup
        path: Optional path for lookup when node_id="by-path"

    Returns:
        Node data including immediate children:
        {
            "node_id": "dir_123_1",
            "name": "gcp",
            "path": "/project/cil/gcp",
            "size": 112442927866637,
            "depth": 1,
            "is_directory": true,
            "file_count": 42,
            "children": [ ... immediate children only ... ]
        }

    Raises:
        404: If node not found
        500: If retrieval fails
    """
    try:
        # Handle "by-path" special case
        if node_id == "by-path":
            if not path:
                raise HTTPException(
                    status_code=400,
                    detail="Path query parameter required when using node_id='by-path'"
                )
            node_data = voronoi_store.get_node_by_path(snapshot_date, path)
            if node_data is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"No node found at path {path} for snapshot {snapshot_date}",
                )
            return JSONResponse(content=node_data)

        # Handle "root" special case
        if node_id == "root":
            actual_node_id = voronoi_store.get_root_node_id(snapshot_date)
            if not actual_node_id:
                raise HTTPException(
                    status_code=404,
                    detail=f"No root node found for snapshot {snapshot_date}. "
                    "Run compute_voronoi.py to generate voronoi data.",
                )
            node_id = actual_node_id

        # Fetch node from ClickHouse by ID
        node_data = voronoi_store.get_node(snapshot_date, node_id)

        if node_data is None:
            raise HTTPException(
                status_code=404,
                detail=f"Node {node_id} not found for snapshot {snapshot_date}",
            )

        return JSONResponse(content=node_data)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve voronoi node: {str(e)}",
        )
