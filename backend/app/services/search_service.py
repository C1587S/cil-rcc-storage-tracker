"""Search service with caching."""

import logging
import time
from typing import Optional

from app.database.duckdb_client import DuckDBClient
from app.services.cache_service import CacheService
from app.models.file_entry import FileEntry
from app.models.response import SearchResponse
from app.config import get_settings

logger = logging.getLogger(__name__)


class SearchService:
    """Service for file search operations."""

    def __init__(self, db_client: DuckDBClient, cache: CacheService):
        """
        Initialize search service.

        Args:
            db_client: DuckDB client instance
            cache: Cache service instance
        """
        self.db = db_client
        self.cache = cache
        self.settings = get_settings()

    async def search_files(
        self,
        pattern: str,
        snapshot: Optional[str] = None,
        regex: bool = True,
        limit: Optional[int] = None,
        offset: int = 0
    ) -> SearchResponse:
        """
        Search for files matching a pattern.

        Args:
            pattern: Search pattern
            snapshot: Snapshot date (None for latest)
            regex: Use regex matching
            limit: Maximum results
            offset: Result offset for pagination

        Returns:
            SearchResponse with results
        """
        start_time = time.time()

        # Determine limit
        limit = min(
            limit or self.settings.default_search_limit,
            self.settings.max_search_limit
        )

        # Build cache key
        cache_key = self.cache.build_key("search", pattern, snapshot or "latest", str(regex), str(limit), str(offset))

        # Try cache first
        cached = await self.cache.get(cache_key)
        if cached:
            execution_time = time.time() - start_time
            logger.info(f"Search cache hit: {pattern} ({execution_time:.3f}s)")
            cached["execution_time"] = execution_time
            return SearchResponse(**cached)

        # Query database
        try:
            df = self.db.search_files(
                pattern=pattern,
                snapshot=snapshot,
                regex=regex,
                limit=limit + offset
            )

            # Apply offset
            if offset > 0:
                df = df[offset:]

            # Convert to FileEntry objects
            results = [FileEntry(**row) for row in df.to_dicts()]

            execution_time = time.time() - start_time

            response_data = {
                "results": results,
                "total": len(results),
                "limit": limit,
                "offset": offset,
                "query": pattern,
                "snapshot": snapshot,
                "execution_time": execution_time
            }

            # Cache the response
            await self.cache.set(cache_key, response_data, ttl=self.settings.redis_ttl_search)

            logger.info(f"Search completed: {pattern} - {len(results)} results ({execution_time:.3f}s)")
            return SearchResponse(**response_data)

        except Exception as e:
            logger.error(f"Error in search service: {e}")
            raise

    async def get_file_history(self, file_path: str) -> list[dict]:
        """
        Get historical information for a specific file.

        Args:
            file_path: Full file path

        Returns:
            List of historical snapshots
        """
        cache_key = self.cache.build_key("history", file_path)

        # Try cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug(f"File history cache hit: {file_path}")
            return cached

        # Query database
        try:
            df = self.db.get_file_history(file_path)
            history = df.to_dicts()

            # Cache the result
            await self.cache.set(cache_key, history, ttl=self.settings.redis_ttl_search)

            logger.info(f"File history retrieved: {file_path} - {len(history)} snapshots")
            return history

        except Exception as e:
            logger.error(f"Error getting file history: {e}")
            return []

    async def search_advanced(
        self,
        path_pattern: Optional[str] = None,
        file_types: Optional[list[str]] = None,
        min_size: Optional[int] = None,
        max_size: Optional[int] = None,
        modified_after: Optional[str] = None,
        modified_before: Optional[str] = None,
        snapshot: Optional[str] = None,
        limit: int = 100
    ) -> list[FileEntry]:
        """
        Advanced search with multiple filters.

        Args:
            path_pattern: Path pattern to match
            file_types: List of file extensions to include
            min_size: Minimum file size in bytes
            max_size: Maximum file size in bytes
            modified_after: Modified after date (YYYY-MM-DD)
            modified_before: Modified before date (YYYY-MM-DD)
            snapshot: Snapshot date
            limit: Maximum results

        Returns:
            List of FileEntry objects
        """
        # Build complex query conditions
        conditions = []

        if path_pattern:
            if "*" in path_pattern:
                like_pattern = path_pattern.replace("*", "%")
                conditions.append(f"path LIKE '{like_pattern}'")
            else:
                conditions.append(f"path LIKE '%{path_pattern}%'")

        if file_types:
            types_str = "', '".join(file_types)
            conditions.append(f"file_type IN ('{types_str}')")

        if min_size is not None:
            conditions.append(f"size >= {min_size}")

        if max_size is not None:
            conditions.append(f"size <= {max_size}")

        if modified_after:
            conditions.append(f"CAST(modified_time AS DATE) >= '{modified_after}'")

        if modified_before:
            conditions.append(f"CAST(modified_time AS DATE) <= '{modified_before}'")

        snapshot_filter = f"CAST(snapshot_date AS VARCHAR) = '{snapshot}'" if snapshot else "1=1"

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        query = f"""
            SELECT
                path,
                size,
                modified_time,
                accessed_time,
                created_time,
                file_type,
                inode,
                permissions,
                parent_path,
                depth,
                top_level_dir,
                CAST(snapshot_date AS VARCHAR) as snapshot_date
            FROM file_snapshots
            WHERE {snapshot_filter}
            AND {where_clause}
            ORDER BY size DESC
            LIMIT {limit}
        """

        try:
            df = self.db.execute_raw_query(query)
            results = [FileEntry(**row) for row in df.to_dicts()]
            logger.info(f"Advanced search returned {len(results)} results")
            return results

        except Exception as e:
            logger.error(f"Error in advanced search: {e}")
            return []
