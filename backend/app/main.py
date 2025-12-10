"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database.duckdb_client import DuckDBClient
from app.routers import snapshots, search, folders, analytics, health

# Configure logging
settings = get_settings()
logging.basicConfig(
    level=settings.log_level,
    format=settings.log_format
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Starting Storage Analytics API")
    logger.info(f"Snapshots path: {settings.snapshots_path}")
    logger.info(f"DuckDB path: {settings.duckdb_path}")
    logger.info(f"Redis enabled: {settings.redis_enabled}")

    # Initialize database connection
    app.state.db_client = DuckDBClient()

    yield

    # Cleanup
    logger.info("Shutting down Storage Analytics API")
    if hasattr(app.state, 'db_client'):
        app.state.db_client.close()


# Create FastAPI application
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description=settings.api_description,
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=settings.cors_allow_methods,
    allow_headers=settings.cors_allow_headers,
)

# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(snapshots.router, prefix="/api/snapshots", tags=["Snapshots"])
app.include_router(search.router, prefix="/api/search", tags=["Search"])
app.include_router(folders.router, prefix="/api/folders", tags=["Folders"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"])


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.debug else "An unexpected error occurred"
        }
    )


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": settings.api_title,
        "version": settings.api_version,
        "description": settings.api_description,
        "docs": "/docs",
        "health": "/health"
    }
