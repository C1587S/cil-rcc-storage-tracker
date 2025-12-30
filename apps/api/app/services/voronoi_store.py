"""
VoronoiStore service for API endpoints.

Provides access to voronoi data stored in ClickHouse.
"""

import json
from datetime import date
from typing import Any, Dict, Optional
from clickhouse_driver import Client
from app.settings import get_settings


class VoronoiStore:
    """
    API service for accessing voronoi data from ClickHouse.
    """

    def __init__(self):
        """Initialize voronoi store with API settings."""
        settings = get_settings()
        self.client = Client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_database,
        )

    def get_node(
        self, snapshot_date: date, node_id: str, include_children: bool = True
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a single node by snapshot_date and node_id.

        Args:
            snapshot_date: Date of the snapshot
            node_id: ID of the node to retrieve
            include_children: If True, fetch full child node objects instead of just IDs

        Returns:
            Node data with full child objects if include_children=True
        """
        query = """
        SELECT node_id, name, path, size, is_directory, depth,
               children_json, file_count, is_synthetic, original_files_json
        FROM voronoi_precomputed
        WHERE snapshot_date = %(snapshot_date)s AND node_id = %(node_id)s
        LIMIT 1
        """
        result = self.client.execute(
            query,
            {"snapshot_date": snapshot_date, "node_id": node_id},
        )
        if not result:
            return None

        parent_row = result[0]  # CRITICAL: Store in separate variable to avoid being overwritten

        # Parse JSON columns
        child_ids = json.loads(parent_row[6]) if parent_row[6] else []
        original_files = json.loads(parent_row[9]) if parent_row[9] else []

        # Fetch full child nodes if requested
        children = []
        if include_children and child_ids:
            # OPTIMIZED: Batch fetch all children in one query instead of N queries
            placeholders = ', '.join(f"%(child_{i})s" for i in range(len(child_ids)))
            batch_query = f"""
            SELECT node_id, name, path, size, is_directory, depth,
                   children_json, file_count, is_synthetic, original_files_json
            FROM voronoi_precomputed
            WHERE snapshot_date = %(snapshot_date)s AND node_id IN ({placeholders})
            """
            params = {"snapshot_date": snapshot_date}
            params.update({f"child_{i}": child_id for i, child_id in enumerate(child_ids)})

            batch_results = self.client.execute(batch_query, params)
            for child_row in batch_results:  # CRITICAL: Use different variable name
                child_children_ids = json.loads(child_row[6]) if child_row[6] else []
                child_original_files = json.loads(child_row[9]) if child_row[9] else []
                children.append({
                    "node_id": child_row[0],
                    "name": child_row[1],
                    "path": child_row[2],
                    "size": child_row[3],
                    "is_directory": child_row[4],
                    "depth": child_row[5],
                    "children": child_children_ids,  # Return IDs only for nested children
                    "children_ids": child_children_ids,
                    "file_count": child_row[7],
                    "is_synthetic": child_row[8],
                    "original_files": child_original_files,
                })
        else:
            # Return just the IDs for non-expanded nodes
            children = child_ids

        return {
            "node_id": parent_row[0],
            "name": parent_row[1],
            "path": parent_row[2],
            "size": parent_row[3],
            "is_directory": parent_row[4],
            "depth": parent_row[5],
            "children": children,  # Full child objects (when include_children=True) or IDs (when False)
            "children_ids": child_ids,  # Always include the original IDs for frontend compatibility
            "file_count": parent_row[7],
            "is_synthetic": parent_row[8],
            "original_files": original_files,
        }

    def get_root_node_id(self, snapshot_date: date) -> Optional[str]:
        """Get the root node ID for a snapshot (depth=0)."""
        query = """
        SELECT node_id
        FROM voronoi_precomputed
        WHERE snapshot_date = %(snapshot_date)s AND depth = 0
        LIMIT 1
        """
        result = self.client.execute(query, {"snapshot_date": snapshot_date})
        return result[0][0] if result else None

    def get_node_by_path(
        self, snapshot_date: date, path: str
    ) -> Optional[Dict[str, Any]]:
        """Get a node by its path instead of node_id."""
        query = """
        SELECT node_id
        FROM voronoi_precomputed
        WHERE snapshot_date = %(snapshot_date)s AND path = %(path)s
        LIMIT 1
        """
        result = self.client.execute(
            query,
            {"snapshot_date": snapshot_date, "path": path},
        )
        if not result:
            return None

        node_id = result[0][0]
        return self.get_node(snapshot_date, node_id)

    def get_stats(self, snapshot_date: date) -> Optional[Dict[str, Any]]:
        """Get statistics for a snapshot's voronoi data."""
        query = """
        SELECT
            count() as total_nodes,
            max(depth) as max_depth
        FROM voronoi_precomputed
        WHERE snapshot_date = %(snapshot_date)s
        """
        result = self.client.execute(query, {"snapshot_date": snapshot_date})
        if not result:
            return None

        return {
            "total_nodes": result[0][0],
            "max_depth": result[0][1],
        }

    def get_subtree(
        self, snapshot_date: date, root_path: str, max_relative_depth: int = 2
    ) -> Dict[str, Dict[str, Any]]:
        """
        OPTIMIZED: Fetch entire subtree in ONE SQL query.

        Instead of recursive N+1 queries, use a single SQL query with path matching.

        Args:
            snapshot_date: Date of snapshot
            root_path: Root path of subtree (e.g., "/project/cil")
            max_relative_depth: Maximum depth relative to root (default 2)

        Returns:
            Dictionary mapping node_id -> node_data for all nodes in subtree
        """
        # First get root node to know its depth
        root_query = """
        SELECT depth FROM voronoi_precomputed
        WHERE snapshot_date = %(snapshot_date)s AND path = %(root_path)s
        LIMIT 1
        """
        root_result = self.client.execute(
            root_query, {"snapshot_date": snapshot_date, "root_path": root_path}
        )
        if not root_result:
            return {}

        root_depth = root_result[0][0]
        max_absolute_depth = root_depth + max_relative_depth

        # OPTIMIZED: Single query to fetch ALL nodes in subtree
        # Uses path prefix matching + depth filtering
        subtree_query = """
        SELECT node_id, name, path, size, is_directory, depth,
               children_json, file_count, is_synthetic, original_files_json
        FROM voronoi_precomputed
        WHERE snapshot_date = %(snapshot_date)s
          AND (path = %(root_path)s OR path LIKE %(path_prefix)s)
          AND depth <= %(max_depth)s
        ORDER BY depth, path
        """
        results = self.client.execute(
            subtree_query,
            {
                "snapshot_date": snapshot_date,
                "root_path": root_path,
                "path_prefix": f"{root_path}/%",
                "max_depth": max_absolute_depth,
            },
        )

        # Convert results to dictionary format
        nodes_dict = {}
        for row in results:
            child_ids = json.loads(row[6]) if row[6] else []
            original_files = json.loads(row[9]) if row[9] else []

            # For all nodes except root, return children as IDs only (not full objects)
            # This matches the existing API contract
            nodes_dict[row[0]] = {
                "node_id": row[0],
                "name": row[1],
                "path": row[2],
                "size": row[3],
                "is_directory": row[4],
                "depth": row[5],
                "children": child_ids,  # Return IDs for consistency with get_node()
                "children_ids": child_ids,
                "file_count": row[7],
                "is_synthetic": row[8],
                "original_files": original_files,
            }

        return nodes_dict
