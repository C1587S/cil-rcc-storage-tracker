"""CIL-rcc-tracker FastAPI application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.settings import get_settings
from app.routers import snapshots, browse, contents, search, query, voronoi, nl_to_sql, computing, projections, auth, feedback

# Get settings
settings = get_settings()

# Create FastAPI app
app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    description=settings.api_description,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS
cors_list = settings.get_cors_origins_list()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        "docs": "/docs",
        "redoc": "/redoc",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from app.db import get_client

    try:
        client = get_client()
        client.execute("SELECT 1")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": "disconnected", "error": str(e)}
