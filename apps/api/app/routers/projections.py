"""Projections monitoring API — live data proxy for pi-mgreenst projection runs."""
import json
import time
import urllib.request
import ssl
from fastapi import APIRouter, HTTPException

from app.settings import get_settings

router = APIRouter(prefix="/api/projections", tags=["projections"])

# In-memory cache for the live report
_cache: dict = {"data": None, "ts": 0}
_CACHE_TTL = 300  # 5 minutes


def _fetch_report() -> dict | None:
    """Fetch latest projection report from RCC, with caching."""
    now = time.time()
    if _cache["data"] and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]

    settings = get_settings()
    url = settings.projections_report_url
    if not url:
        return None

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={"User-Agent": "cil-tracker/1.0"})
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            data = json.loads(resp.read().decode())
        _cache["data"] = data
        _cache["ts"] = now
        return data
    except Exception:
        # Return stale cache if available
        if _cache["data"]:
            return _cache["data"]
        return None


@router.get("/latest")
async def get_latest_report():
    """Return the latest projection report from RCC (cached 5 min)."""
    import asyncio
    data = await asyncio.to_thread(_fetch_report)
    if not data:
        raise HTTPException(status_code=503, detail="Projection report unavailable")
    return data
