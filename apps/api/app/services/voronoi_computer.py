"""
Voronoi computation service for precomputing hierarchical voronoi treemap data.

This service replicates the frontend voronoi computation logic in Python,
generating complete voronoi artifacts for each snapshot that can be served
statically without real-time computation.
"""

import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict
from app.db import execute_query

logger = logging.getLogger(__name__)


@dataclass
class VoronoiNodeData:
    """
    Represents a single node in the voronoi hierarchy.
    Maps to the frontend VoronoiNode interface.
    """

    id: str
    name: str
    path: str
    size: int
    file_count: Optional[int] = None
    isDirectory: bool = True
    depth: int = 0
    children: Optional[List[str]] = None  # References to child node IDs
    # Visual properties (populated during computation)
    color: Optional[str] = None
    polygon: Optional[List[List[float]]] = None  # [[x,y], [x,y], ...]
    # Metadata for synthetic file nodes
    isSynthetic: bool = False
    originalFiles: Optional[List[Dict[str, Any]]] = None


@dataclass
class VoronoiArtifact:
    """
    Complete voronoi artifact for a snapshot.
    This is the JSON structure that will be saved to disk.
    """

    version: str = "1.0.0"
    snapshot: Dict[str, Any] = None  # {date, path, size, file_count}
    computed_at: str = None  # ISO timestamp
    hierarchy: Dict[str, Any] = None  # {nodes, polygons, metadata}


class VoronoiComputer:
    """
    Computes hierarchical voronoi treemap data for a snapshot.

    This service fetches data from ClickHouse and builds a hierarchical
    tree structure similar to the frontend's buildVoronoiTree function.
    """

    def __init__(self, snapshot_date: date, root_path: str = "/project/cil"):
        """
        Initialize voronoi computer for a specific snapshot.

        Args:
            snapshot_date: The snapshot date to compute for
            root_path: Root path to start computation from (default: /project/cil)
        """
        self.snapshot_date = snapshot_date
        self.root_path = root_path
        self.nodes: Dict[str, VoronoiNodeData] = {}  # node_id -> node data
        self.node_counter = 0

    def _generate_node_id(self, path: str, is_directory: bool) -> str:
        """Generate unique node ID."""
        self.node_counter += 1
        prefix = "dir" if is_directory else "file"
        # Use path hash to ensure consistency
        path_hash = abs(hash(path)) % 10000
        return f"{prefix}_{path_hash}_{self.node_counter}"

    def _fetch_folders(
        self, parent_path: str, limit: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        Fetch child folders for a directory.
        Mirrors the frontend's getBrowse() call.
        """
        # Normalize parent_path
        if parent_path != "/" and parent_path.endswith("/"):
            parent_path = parent_path.rstrip("/")

        query = """
        SELECT
            h.child_path AS path,
            h.name,
            1 AS is_directory,
            COALESCE(rs.recursive_size_bytes, 0) AS recursive_size,
            COALESCE(rs.direct_size_bytes, 0) AS size,
            COALESCE(rs.direct_file_count, 0) AS file_count,
            COALESCE(rs.recursive_dir_count, 0) AS dir_count
        FROM filesystem.directory_hierarchy AS h
        LEFT JOIN filesystem.directory_recursive_sizes AS rs
            ON rs.snapshot_date = h.snapshot_date
            AND rs.path = h.child_path
        WHERE h.snapshot_date = %(snapshot_date)s
          AND h.parent_path = %(parent_path)s
          AND h.is_directory = 1
        ORDER BY recursive_size DESC
        LIMIT %(limit)s
        """

        try:
            results = execute_query(
                query,
                {
                    "snapshot_date": self.snapshot_date.isoformat(),
                    "parent_path": parent_path,
                    "limit": limit,
                },
            )
            return results
        except Exception as e:
            logger.error(f"Error fetching folders for {parent_path}: {e}")
            return []

    def _fetch_files(
        self, parent_path: str, limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Fetch files in a directory.
        Mirrors the frontend's getContents() call for files.
        """
        # Normalize parent_path
        if parent_path != "/" and parent_path.endswith("/"):
            parent_path = parent_path.rstrip("/")

        query = """
        SELECT
            path,
            name,
            size,
            0 AS is_directory
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot_date)s
          AND parent_path = %(parent_path)s
          AND is_directory = 0
        ORDER BY size DESC
        LIMIT %(limit)s
        """

        try:
            results = execute_query(
                query,
                {
                    "snapshot_date": self.snapshot_date.isoformat(),
                    "parent_path": parent_path,
                    "limit": limit,
                },
            )
            return results
        except Exception as e:
            logger.error(f"Error fetching files for {parent_path}: {e}")
            return []

    def _build_node_recursive(
        self,
        path: str,
        name: str,
        size: int,
        is_directory: bool,
        current_depth: int,
        max_depth: int,
        file_count: Optional[int] = None,
    ) -> Optional[VoronoiNodeData]:
        """
        Recursively build a node and its children.

        Args:
            path: Node path
            name: Node name
            size: Node size in bytes
            is_directory: Whether this is a directory
            current_depth: Current recursion depth
            max_depth: Maximum depth to recurse (2 for preview)
            file_count: Number of files (for directories)

        Returns:
            VoronoiNodeData or None if node should be skipped
        """
        if size <= 0:
            return None

        node_id = self._generate_node_id(path, is_directory)
        child_ids: List[str] = []

        # If directory and within depth limit, fetch children
        if is_directory and current_depth < max_depth:
            # Fetch subdirectories
            folders = self._fetch_folders(path, limit=500)
            for folder in folders:
                child_node = self._build_node_recursive(
                    path=folder["path"],
                    name=folder["name"],
                    size=folder.get("recursive_size", folder.get("size", 0)),
                    is_directory=True,
                    current_depth=current_depth + 1,
                    max_depth=max_depth,
                    file_count=folder.get("file_count"),
                )
                if child_node:
                    self.nodes[child_node.id] = child_node
                    child_ids.append(child_node.id)

            # Fetch files at this level
            files = self._fetch_files(path, limit=50)
            if files:
                # Create synthetic __files__ node
                files_size = sum(f.get("size", 0) for f in files)
                if files_size > 0:
                    files_node_id = self._generate_node_id(f"{path}/__files__", False)
                    files_node = VoronoiNodeData(
                        id=files_node_id,
                        name="__files__",
                        path=f"{path}/__files__",
                        size=files_size,
                        isDirectory=False,
                        isSynthetic=True,
                        depth=current_depth + 1,
                        file_count=len(files),
                        originalFiles=[
                            {
                                "name": f["name"],
                                "path": f["path"],
                                "size": f["size"],
                                "isDirectory": False,
                            }
                            for f in files
                        ],
                    )
                    self.nodes[files_node_id] = files_node
                    child_ids.append(files_node_id)

        # Create the node
        node = VoronoiNodeData(
            id=node_id,
            name=name,
            path=path,
            size=size,
            isDirectory=is_directory,
            depth=current_depth,
            file_count=file_count,
            children=child_ids if child_ids else None,
        )

        return node

    def compute(self, preview_depth: int = 2) -> VoronoiArtifact:
        """
        Compute complete voronoi hierarchy for the snapshot.

        Args:
            preview_depth: Depth of preview to precompute (default 2)

        Returns:
            VoronoiArtifact ready to be serialized to JSON
        """
        logger.info(
            f"Starting voronoi computation for snapshot {self.snapshot_date} at path {self.root_path}"
        )

        # Build hierarchy starting from root
        root_folders = self._fetch_folders(self.root_path, limit=1000)
        root_files = self._fetch_files(self.root_path, limit=100)

        # Build child nodes
        child_ids: List[str] = []

        # Process folders
        for folder in root_folders:
            child_node = self._build_node_recursive(
                path=folder["path"],
                name=folder["name"],
                size=folder.get("recursive_size", folder.get("size", 0)),
                is_directory=True,
                current_depth=1,
                max_depth=preview_depth,
                file_count=folder.get("file_count"),
            )
            if child_node:
                self.nodes[child_node.id] = child_node
                child_ids.append(child_node.id)

        # Process root-level files (create synthetic node if files exist)
        if root_files:
            files_size = sum(f.get("size", 0) for f in root_files)
            if files_size > 0:
                files_node_id = self._generate_node_id(f"{self.root_path}/__files__", False)
                files_node = VoronoiNodeData(
                    id=files_node_id,
                    name="__files__",
                    path=f"{self.root_path}/__files__",
                    size=files_size,
                    isDirectory=False,
                    isSynthetic=True,
                    depth=1,
                    file_count=len(root_files),
                    originalFiles=[
                        {
                            "name": f["name"],
                            "path": f["path"],
                            "size": f["size"],
                            "isDirectory": False,
                        }
                        for f in root_files
                    ],
                )
                self.nodes[files_node_id] = files_node
                child_ids.append(files_node_id)

        # Calculate total size
        total_size = sum(self.nodes[cid].size for cid in child_ids)
        total_file_count = sum(
            self.nodes[cid].file_count or 0 for cid in child_ids if self.nodes[cid].file_count
        )

        # Create root node
        root_node_id = self._generate_node_id(self.root_path, True)
        root_name = (
            "root" if self.root_path == "/" else self.root_path.split("/")[-1] or "root"
        )
        root_node = VoronoiNodeData(
            id=root_node_id,
            name=root_name,
            path=self.root_path,
            size=total_size,
            isDirectory=True,
            depth=0,
            file_count=total_file_count,
            children=child_ids,
        )
        self.nodes[root_node_id] = root_node

        # Build artifact
        artifact = VoronoiArtifact(
            version="1.0.0",
            snapshot={
                "date": self.snapshot_date.isoformat(),
                "path": self.root_path,
                "size": total_size,
                "file_count": total_file_count,
            },
            computed_at=datetime.utcnow().isoformat() + "Z",
            hierarchy={
                "root_node_id": root_node_id,
                "nodes": {
                    node_id: asdict(node_data) for node_id, node_data in self.nodes.items()
                },
                "metadata": {
                    "total_nodes": len(self.nodes),
                    "max_depth": preview_depth,
                    "top_level_count": len(child_ids),
                },
            },
        )

        logger.info(
            f"Voronoi computation complete: {len(self.nodes)} nodes, "
            f"{total_size:,} bytes, {total_file_count:,} files"
        )

        return artifact
