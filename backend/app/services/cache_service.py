"""Redis caching service."""

import json
import logging
from typing import Any, Optional
import redis.asyncio as redis

from app.config import get_settings

logger = logging.getLogger(__name__)


class CacheService:
    """Redis-based caching service for API responses."""

    def __init__(self):
        """Initialize cache service."""
        self.settings = get_settings()
        self.client: Optional[redis.Redis] = None
        self.enabled = self.settings.redis_enabled

        if self.enabled:
            try:
                self.client = redis.Redis(
                    host=self.settings.redis_host,
                    port=self.settings.redis_port,
                    db=self.settings.redis_db,
                    decode_responses=True
                )
                logger.info(f"Redis cache initialized: {self.settings.redis_host}:{self.settings.redis_port}")
            except Exception as e:
                logger.warning(f"Could not initialize Redis, caching disabled: {e}")
                self.enabled = False
                self.client = None

    async def get(self, key: str) -> Optional[Any]:
        """
        Get value from cache.

        Args:
            key: Cache key

        Returns:
            Cached value or None if not found
        """
        if not self.enabled or not self.client:
            return None

        try:
            value = await self.client.get(key)
            if value:
                logger.debug(f"Cache hit: {key}")
                return json.loads(value)
            else:
                logger.debug(f"Cache miss: {key}")
                return None
        except Exception as e:
            logger.error(f"Error getting from cache: {e}")
            return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None
    ) -> bool:
        """
        Set value in cache.

        Args:
            key: Cache key
            value: Value to cache
            ttl: Time-to-live in seconds (None for default)

        Returns:
            True if successful
        """
        if not self.enabled or not self.client:
            return False

        try:
            ttl = ttl or self.settings.redis_ttl_default
            serialized = json.dumps(value, default=str)

            await self.client.setex(key, ttl, serialized)
            logger.debug(f"Cache set: {key} (TTL: {ttl}s)")
            return True
        except Exception as e:
            logger.error(f"Error setting cache: {e}")
            return False

    async def delete(self, key: str) -> bool:
        """
        Delete key from cache.

        Args:
            key: Cache key

        Returns:
            True if successful
        """
        if not self.enabled or not self.client:
            return False

        try:
            await self.client.delete(key)
            logger.debug(f"Cache deleted: {key}")
            return True
        except Exception as e:
            logger.error(f"Error deleting from cache: {e}")
            return False

    async def invalidate_pattern(self, pattern: str) -> int:
        """
        Invalidate all keys matching a pattern.

        Args:
            pattern: Key pattern (e.g., "search:*")

        Returns:
            Number of keys deleted
        """
        if not self.enabled or not self.client:
            return 0

        try:
            keys = []
            async for key in self.client.scan_iter(match=pattern):
                keys.append(key)

            if keys:
                deleted = await self.client.delete(*keys)
                logger.info(f"Invalidated {deleted} keys matching pattern: {pattern}")
                return deleted
            return 0
        except Exception as e:
            logger.error(f"Error invalidating cache pattern: {e}")
            return 0

    async def clear_all(self) -> bool:
        """
        Clear all cache entries.

        Returns:
            True if successful
        """
        if not self.enabled or not self.client:
            return False

        try:
            await self.client.flushdb()
            logger.info("All cache entries cleared")
            return True
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return False

    def build_key(self, *parts: str) -> str:
        """
        Build a cache key from parts.

        Args:
            *parts: Key components

        Returns:
            Formatted cache key
        """
        return ":".join(str(p) for p in parts)

    async def close(self):
        """Close Redis connection."""
        if self.client:
            await self.client.close()
            logger.info("Redis connection closed")
