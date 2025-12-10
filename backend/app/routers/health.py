"""Health check router."""

import logging
from fastapi import APIRouter, Depends
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.

    Returns:
        Health status information
    """
    settings = get_settings()

    return {
        "status": "healthy",
        "service": settings.api_title,
        "version": settings.api_version,
        "redis_enabled": settings.redis_enabled
    }


@router.get("/health/db")
async def database_health():
    """
    Database health check.

    Returns:
        Database connection status
    """
    # TODO: Implement actual database health check
    return {
        "status": "healthy",
        "type": "duckdb",
        "message": "Database connection active"
    }
