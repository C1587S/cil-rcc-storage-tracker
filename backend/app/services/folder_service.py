"""Folder analysis service."""

import logging
from typing import Optional
import polars as pl

from app.database.duckdb_client import DuckDBClient
from app.database.queries import QueryBuilder
from app.services.cache_service import CacheService
from app.models.response import FolderBreakdown, FolderItem, FolderTree, FolderTreeNode
from app.config import get_settings

logger = logging.getLogger(__name__)


class FolderService:
    """Service for folder analysis operations."""

    def __init__(self, db_client: DuckDBClient, cache: CacheService):
        """
        Initialize folder service.

        Args:
            db_client: DuckDB client instance
            cache: Cache service instance
        """
        self.db = db_client
        self.cache = cache
        self.settings = get_settings()
        self.query_builder = QueryBuilder()

    async def get_folder_breakdown(
        self,
        path: str,
        snapshot: str,
        depth: int = 1,
        group_by: str = "directory"
    ) -> FolderBreakdown:
        """
        Get folder breakdown with size analysis.

        Args:
            path: Folder path
            snapshot: Snapshot date
            depth: Analysis depth
            group_by: Group by 'directory' or 'type'

        Returns:
            FolderBreakdown object
        """
        cache_key = self.cache.build_key("folder", path, snapshot, str(depth), group_by)

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug(f"Folder breakdown cache hit: {path}")
            return FolderBreakdown(**cached)

        # Query database
        try:
            df = self.db.get_folder_breakdown(path, snapshot, depth, group_by)

            if df.is_empty():
                return FolderBreakdown(
                    path=path,
                    total_size=0,
                    file_count=0,
                    directory_count=0,
                    items=[],
                    snapshot=snapshot,
                    depth=depth
                )

            # Calculate total size for percentages
            total_size = df["total_size"].sum()

            # Convert to FolderItem objects
            items = []
            for row in df.to_dicts():
                item = FolderItem(
                    name=row["name"],
                    path=f"{path}/{row['name']}" if not path.endswith("/") else f"{path}{row['name']}",
                    size=row["total_size"],
                    file_count=row["file_count"],
                    is_directory=group_by == "directory",
                    file_type=None if group_by == "directory" else row["name"],
                    percentage=(row["total_size"] / total_size * 100) if total_size > 0 else 0,
                    last_modified=str(row.get("last_modified")) if row.get("last_modified") else None
                )
                items.append(item)

            breakdown = FolderBreakdown(
                path=path,
                total_size=int(total_size),
                file_count=df["file_count"].sum(),
                directory_count=len(items) if group_by == "directory" else 0,
                items=items,
                snapshot=snapshot,
                depth=depth
            )

            # Cache the result
            await self.cache.set(cache_key, breakdown.model_dump(), ttl=self.settings.redis_ttl_folders)

            logger.info(f"Folder breakdown: {path} - {len(items)} items, {total_size:,} bytes")
            return breakdown

        except Exception as e:
            logger.error(f"Error in folder breakdown: {e}")
            raise

    async def get_folder_tree(
        self,
        path: str,
        snapshot: str,
        max_depth: int = 3
    ) -> FolderTree:
        """
        Get hierarchical folder tree.

        Args:
            path: Root path
            snapshot: Snapshot date
            max_depth: Maximum tree depth

        Returns:
            FolderTree object
        """
        cache_key = self.cache.build_key("tree", path, snapshot, str(max_depth))

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug(f"Folder tree cache hit: {path}")
            return FolderTree(**cached)

        try:
            # Build tree recursively
            root_node = await self._build_tree_node(path, snapshot, 0, max_depth)

            tree = FolderTree(
                root=root_node,
                snapshot=snapshot,
                max_depth=max_depth
            )

            # Cache the result
            await self.cache.set(cache_key, tree.model_dump(), ttl=self.settings.redis_ttl_folders)

            logger.info(f"Folder tree built: {path} (depth: {max_depth})")
            return tree

        except Exception as e:
            logger.error(f"Error building folder tree: {e}")
            raise

    async def _build_tree_node(
        self,
        path: str,
        snapshot: str,
        current_depth: int,
        max_depth: int
    ) -> FolderTreeNode:
        """
        Recursively build tree node.

        Args:
            path: Node path
            snapshot: Snapshot date
            current_depth: Current depth in tree
            max_depth: Maximum depth to build

        Returns:
            FolderTreeNode
        """
        # Get immediate children
        df = self.db.get_folder_breakdown(path, snapshot, depth=1)

        if df.is_empty():
            return FolderTreeNode(
                name=path.split("/")[-1] or path,
                path=path,
                size=0,
                file_count=0,
                is_directory=True,
                children=[],
                percentage=0
            )

        # Calculate total size
        total_size = df["total_size"].sum()

        children = []

        # Build child nodes if within depth limit
        if current_depth < max_depth:
            for row in df.to_dicts():
                child_path = f"{path}/{row['name']}" if not path.endswith("/") else f"{path}{row['name']}"
                child_node = await self._build_tree_node(child_path, snapshot, current_depth + 1, max_depth)
                children.append(child_node)

        node = FolderTreeNode(
            name=path.split("/")[-1] or path,
            path=path,
            size=int(total_size),
            file_count=df["file_count"].sum(),
            is_directory=True,
            children=children,
            percentage=100.0  # Will be calculated relative to root
        )

        return node

    async def get_folder_timeline(
        self,
        path: str,
        start_date: str,
        end_date: str,
        metric: str = "size"
    ) -> list[dict]:
        """
        Get folder size/count over time.

        Args:
            path: Folder path
            start_date: Start date
            end_date: End date
            metric: Metric to track ('size', 'count', 'types')

        Returns:
            List of timeline data points
        """
        cache_key = self.cache.build_key("timeline", path, start_date, end_date, metric)

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            return cached

        try:
            query = self.query_builder.build_timeline_query(path, start_date, end_date, metric)
            df = self.db.execute_raw_query(query)

            timeline = df.to_dicts()

            # Cache the result
            await self.cache.set(cache_key, timeline, ttl=self.settings.redis_ttl_folders)

            logger.info(f"Timeline generated: {path} ({start_date} to {end_date})")
            return timeline

        except Exception as e:
            logger.error(f"Error generating timeline: {e}")
            return []

    async def get_type_distribution(
        self,
        path: str,
        snapshot: str
    ) -> list[dict]:
        """
        Get file type distribution for a folder.

        Args:
            path: Folder path
            snapshot: Snapshot date

        Returns:
            List of type distribution data
        """
        cache_key = self.cache.build_key("types", path, snapshot)

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            return cached

        try:
            df = self.db.get_folder_breakdown(path, snapshot, depth=1, group_by="type")
            distribution = df.to_dicts()

            # Cache the result
            await self.cache.set(cache_key, distribution, ttl=self.settings.redis_ttl_folders)

            logger.info(f"Type distribution: {path} - {len(distribution)} types")
            return distribution

        except Exception as e:
            logger.error(f"Error getting type distribution: {e}")
            return []
