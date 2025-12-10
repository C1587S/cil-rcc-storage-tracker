"""Snapshot management service."""

import logging
from typing import Optional

from app.database.duckdb_client import DuckDBClient
from app.services.cache_service import CacheService
from app.models.snapshot import Snapshot, SnapshotInfo, SnapshotComparison
from app.models.file_entry import FileEntry
from app.config import get_settings

logger = logging.getLogger(__name__)


class SnapshotService:
    """Service for snapshot management operations."""

    def __init__(self, db_client: DuckDBClient, cache: CacheService):
        """
        Initialize snapshot service.

        Args:
            db_client: DuckDB client instance
            cache: Cache service instance
        """
        self.db = db_client
        self.cache = cache
        self.settings = get_settings()

    async def list_snapshots(self) -> list[Snapshot]:
        """
        List all available snapshots.

        Returns:
            List of Snapshot objects
        """
        cache_key = "snapshots:list"

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug("Snapshots list cache hit")
            return [Snapshot(**s) for s in cached]

        # Query database
        try:
            snapshots_data = self.db.list_snapshots()
            snapshots = [Snapshot(**data) for data in snapshots_data]

            # Cache with longer TTL
            await self.cache.set(
                cache_key,
                [s.model_dump() for s in snapshots],
                ttl=self.settings.redis_ttl_snapshots
            )

            logger.info(f"Listed {len(snapshots)} snapshots")
            return snapshots

        except Exception as e:
            logger.error(f"Error listing snapshots: {e}")
            return []

    async def get_snapshot(self, date: str) -> Optional[SnapshotInfo]:
        """
        Get detailed snapshot information.

        Args:
            date: Snapshot date (YYYY-MM-DD)

        Returns:
            SnapshotInfo object or None
        """
        cache_key = self.cache.build_key("snapshot", date)

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug(f"Snapshot info cache hit: {date}")
            return SnapshotInfo(**cached)

        # Query database
        try:
            snapshot_data = self.db.get_snapshot_info(date)
            if not snapshot_data:
                return None

            # Get breakdown by directory
            breakdown_by_dir = await self._get_breakdown_by_directory(date)

            # Get breakdown by type
            breakdown_by_type = await self._get_breakdown_by_type(date)

            # Get largest files
            largest_files = await self._get_largest_files(date, limit=10)

            snapshot_info = SnapshotInfo(
                snapshot=Snapshot(**snapshot_data),
                breakdown_by_dir=breakdown_by_dir,
                breakdown_by_type=breakdown_by_type,
                largest_files=largest_files
            )

            # Cache the result
            await self.cache.set(
                cache_key,
                snapshot_info.model_dump(),
                ttl=self.settings.redis_ttl_snapshots
            )

            logger.info(f"Retrieved snapshot info: {date}")
            return snapshot_info

        except Exception as e:
            logger.error(f"Error getting snapshot: {e}")
            return None

    async def get_latest_snapshot(self) -> Optional[Snapshot]:
        """
        Get the most recent snapshot.

        Returns:
            Snapshot object or None
        """
        snapshots = await self.list_snapshots()
        if snapshots:
            return snapshots[0]  # Already sorted by date DESC
        return None

    async def compare_snapshots(
        self,
        from_date: str,
        to_date: str
    ) -> Optional[SnapshotComparison]:
        """
        Compare two snapshots.

        Args:
            from_date: Earlier snapshot date
            to_date: Later snapshot date

        Returns:
            SnapshotComparison object or None
        """
        cache_key = self.cache.build_key("compare", from_date, to_date)

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug(f"Snapshot comparison cache hit: {from_date} to {to_date}")
            return SnapshotComparison(**cached)

        # Query database
        try:
            comparison_data = self.db.compare_snapshots(from_date, to_date)

            if not comparison_data:
                return None

            # Get largest additions
            largest_additions = await self._get_largest_additions(from_date, to_date, limit=10)

            # Get largest removals
            largest_removals = await self._get_largest_removals(from_date, to_date, limit=10)

            comparison = SnapshotComparison(
                from_date=from_date,
                to_date=to_date,
                size_change=comparison_data.get("size_change", 0),
                file_count_change=comparison_data.get("file_count_change", 0),
                files_added=comparison_data.get("files_added", 0),
                files_removed=comparison_data.get("files_removed", 0),
                files_modified=comparison_data.get("files_modified", 0),
                largest_additions=largest_additions,
                largest_removals=largest_removals
            )

            # Cache the result
            await self.cache.set(
                cache_key,
                comparison.model_dump(),
                ttl=self.settings.redis_ttl_snapshots
            )

            logger.info(f"Compared snapshots: {from_date} to {to_date}")
            return comparison

        except Exception as e:
            logger.error(f"Error comparing snapshots: {e}")
            return None

    async def _get_breakdown_by_directory(self, snapshot: str) -> dict[str, dict]:
        """Get breakdown by top-level directory."""
        try:
            query = f"""
                SELECT
                    top_level_dir,
                    COUNT(*) as file_count,
                    SUM(size) as total_size
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                GROUP BY top_level_dir
                ORDER BY total_size DESC
            """

            df = self.db.execute_raw_query(query)
            breakdown = {}
            for row in df.to_dicts():
                breakdown[row["top_level_dir"]] = {
                    "file_count": row["file_count"],
                    "total_size": row["total_size"]
                }

            return breakdown

        except Exception as e:
            logger.error(f"Error getting directory breakdown: {e}")
            return {}

    async def _get_breakdown_by_type(self, snapshot: str) -> dict[str, dict]:
        """Get breakdown by file type."""
        try:
            query = f"""
                SELECT
                    file_type,
                    COUNT(*) as file_count,
                    SUM(size) as total_size
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{snapshot}'
                AND file_type != 'directory'
                GROUP BY file_type
                ORDER BY total_size DESC
                LIMIT 20
            """

            df = self.db.execute_raw_query(query)
            breakdown = {}
            for row in df.to_dicts():
                breakdown[row["file_type"]] = {
                    "file_count": row["file_count"],
                    "total_size": row["total_size"]
                }

            return breakdown

        except Exception as e:
            logger.error(f"Error getting type breakdown: {e}")
            return {}

    async def _get_largest_files(self, snapshot: str, limit: int) -> list[dict]:
        """Get largest files in snapshot."""
        try:
            df = self.db.get_heavy_files(snapshot, limit=limit)
            return df.to_dicts()
        except Exception as e:
            logger.error(f"Error getting largest files: {e}")
            return []

    async def _get_largest_additions(
        self,
        from_date: str,
        to_date: str,
        limit: int
    ) -> list[dict]:
        """Get largest files added between snapshots."""
        try:
            query = f"""
                SELECT
                    path,
                    size,
                    file_type,
                    modified_time
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{to_date}'
                AND path NOT IN (
                    SELECT path FROM file_snapshots
                    WHERE CAST(snapshot_date AS VARCHAR) = '{from_date}'
                )
                AND file_type != 'directory'
                ORDER BY size DESC
                LIMIT {limit}
            """

            df = self.db.execute_raw_query(query)
            return df.to_dicts()

        except Exception as e:
            logger.error(f"Error getting largest additions: {e}")
            return []

    async def _get_largest_removals(
        self,
        from_date: str,
        to_date: str,
        limit: int
    ) -> list[dict]:
        """Get largest files removed between snapshots."""
        try:
            query = f"""
                SELECT
                    path,
                    size,
                    file_type,
                    modified_time
                FROM file_snapshots
                WHERE CAST(snapshot_date AS VARCHAR) = '{from_date}'
                AND path NOT IN (
                    SELECT path FROM file_snapshots
                    WHERE CAST(snapshot_date AS VARCHAR) = '{to_date}'
                )
                AND file_type != 'directory'
                ORDER BY size DESC
                LIMIT {limit}
            """

            df = self.db.execute_raw_query(query)
            return df.to_dicts()

        except Exception as e:
            logger.error(f"Error getting largest removals: {e}")
            return []
