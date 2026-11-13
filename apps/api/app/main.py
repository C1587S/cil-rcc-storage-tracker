"""CIL-rcc-tracker FastAPI application."""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.settings import get_settings
from app.ratelimit import RateLimitMiddleware
from app.routers import housekeeping, recon, dupverify, snapshots, browse, contents, search, query, voronoi, nl_to_sql, computing, projections, auth, feedback

log = logging.getLogger("app")

# Get settings
settings = get_settings()

# Create FastAPI app. Interactive docs are opt-in (API_DOCS=true): they map
# every endpoint for anyone who can reach the API.
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description=settings.api_description,
    docs_url="/docs" if settings.api_docs else None,
    redoc_url="/redoc" if settings.api_docs else None,
    openapi_url="/openapi.json" if settings.api_docs else None,
)

# CORS: the browser calls the same-origin Next.js proxy, so this only
# matters for local development. No cookies are used (privileged calls
# carry an explicit header secret), so credentials are not allowed and a
# cross-site request has no ambient credential to ride on (no CSRF).
cors_list = settings.get_cors_origins_list()
# Subtree/report payloads are multi-MB JSON full of repetitive paths —
# gzip cuts them ~4x through the tunnel.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-User", "X-Operator-Key", "X-Exec-Token", "X-Delete-Token"],
)

# Register routers
app.include_router(snapshots.router)
app.include_router(browse.router)
app.include_router(contents.router)
app.include_router(search.router)
app.include_router(query.router)
app.include_router(voronoi.router)
app.include_router(nl_to_sql.router)
app.include_router(computing.router)
app.include_router(projections.router)
app.include_router(auth.router)
app.include_router(housekeeping.router)
app.include_router(recon.router)
app.include_router(dupverify.router)
app.include_router(feedback.router)


# Prefetch external reports on startup so first page load is instant
@app.on_event("startup")
async def _prefetch_reports():
    import asyncio
    from app.routers.computing import _fetch_report as fetch_computing
    from app.routers.projections import _fetch_report as fetch_projections
    asyncio.get_event_loop().run_in_executor(None, fetch_computing)
    asyncio.get_event_loop().run_in_executor(None, fetch_projections)


@app.get("/")
async def root():
    """Root endpoint - API info."""
    return {
        "name": settings.api_title,
        "version": settings.api_version,
        "description": settings.api_description,
    }


@app.get("/health")
async def health_check():
    """Health check endpoint. Failure details go to the server log only."""
    from app.db import get_client

    try:
        client = get_client()
        client.execute("SELECT 1")
        return {"status": "healthy", "database": "connected"}
    except Exception:
        log.exception("health check: database unreachable")
        return {"status": "unhealthy", "database": "disconnected"}
