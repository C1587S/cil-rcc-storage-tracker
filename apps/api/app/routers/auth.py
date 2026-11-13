"""Lightweight auth — validate username against group members + allowed list."""
import asyncio
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.security import normalize_username
from app.settings import get_settings
from app import rcc_tls

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Cache group members for 10 minutes to avoid slow HTTP calls on every login
_group_cache: dict[str, object] = {"members": [], "fetched_at": 0.0}
_CACHE_TTL = 600  # seconds


def _fetch_group_members() -> list[str]:
    """Get group_members from the computing report, with caching."""
    now = time.time()
    if now - _group_cache["fetched_at"] < _CACHE_TTL and _group_cache["members"]:
        return _group_cache["members"]

    import json

    settings = get_settings()
    url = settings.computing_report_url
    if not url:
        return _group_cache["members"] or []

    try:
        # Verified TLS, else pinned RCC key (see app/rcc_tls.py).
        data = json.loads(rcc_tls.fetch(url, timeout=10).decode())
        members = data.get("group_members", [])
        _group_cache["members"] = members
        _group_cache["fetched_at"] = now
        return members
    except Exception:
        return _group_cache["members"] or []


class ValidateRequest(BaseModel):
    username: str


@router.post("/validate")
async def validate_user(body: ValidateRequest):
    """Check if a username is in the allowed list."""
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required")
    username = normalize_username(body.username)
    if username is None:
        raise HTTPException(status_code=400, detail="Username not recognized")

    settings = get_settings()
    additional = [u.lower() for u in settings.get_allowed_users_list()]

    # Fetch group members from the report (cached)
    group_members = await asyncio.to_thread(_fetch_group_members)
    group_lower = [u.lower() for u in group_members]

    allowed = set(group_lower + additional)

    if username in allowed:
        return {"valid": True, "username": username}

    raise HTTPException(status_code=403, detail="Username not recognized")
