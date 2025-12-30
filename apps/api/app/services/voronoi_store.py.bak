"""
VoronoiStore service wrapper for API endpoints.

This is a thin wrapper around the clickhouse/scripts/voronoi_storage.py library,
configured with API application settings.

The actual ClickHouse storage logic lives in clickhouse/scripts/ to keep
infrastructure code separate from API business logic.
"""

import sys
from pathlib import Path
from datetime import date
from typing import Any, Dict, Optional
from app.settings import get_settings

# Import the ClickHouse storage library
# Add the repository root to Python path to enable imports
repo_root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(repo_root))

from clickhouse.scripts.voronoi_storage import VoronoiStorage


class VoronoiStore:
    """
    API service wrapper for VoronoiStorage.

    Provides a configured instance of VoronoiStorage using API settings.
    All actual storage logic is delegated to clickhouse/scripts/voronoi_storage.py.
    """

    def __init__(self, batch_size: int = 1000):
        """
        Initialize voronoi store with API settings.

        Args:
            batch_size: Number of records to batch before inserting
        """
        settings = get_settings()

        # Delegate to ClickHouse storage library
        self._storage = VoronoiStorage(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
            database=settings.clickhouse_database,
            batch_size=batch_size,
        )

    def get_node(
        self, snapshot_date: date, node_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve a single node by snapshot_date and node_id.

        Args:
            snapshot_date: Snapshot date
            node_id: Node ID to retrieve

        Returns:
            Node data as dict, or None if not found
        """
        return self._storage.get_node(snapshot_date, node_id)

    def get_root_node_id(self, snapshot_date: date) -> Optional[str]:
        """
        Get the root node ID for a snapshot (depth=0).

        Args:
            snapshot_date: Snapshot date

        Returns:
            Root node_id or None if not found
        """
        return self._storage.get_root_node_id(snapshot_date)

    def get_node_by_path(
        self, snapshot_date: date, path: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get a node by its path instead of node_id.

        Args:
            snapshot_date: Snapshot date
            path: Full path to the node

        Returns:
            Node data as dict, or None if not found
        """
        return self._storage.get_node_by_path(snapshot_date, path)

    def get_stats(self, snapshot_date: date) -> Optional[Dict[str, Any]]:
        """
        Get statistics for a snapshot's voronoi data.

        Args:
            snapshot_date: Snapshot date

        Returns:
            Stats dict with total_nodes, max_depth, etc.
        """
        return self._storage.get_stats(snapshot_date)
