"""Lightweight auth — validate username against group members + allowed list."""
import asyncio
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.settings import get_settings

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
    import ssl
    import urllib.request

    settings = get_settings()
    url = settings.computing_report_url
    if not url:
        return _group_cache["members"] or []

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={"User-Agent": "cil-tracker/1.0"})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            data = json.loads(resp.read().decode())
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
    username = body.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="Username required")

    settings = get_settings()
    additional = [u.lower() for u in settings.get_allowed_users_list()]

    # Fetch group members from the report (cached)
    group_members = await asyncio.to_thread(_fetch_group_members)
    group_lower = [u.lower() for u in group_members]

    allowed = set(group_lower + additional)

    if username in allowed:
        return {"valid": True, "username": username}

    raise HTTPException(status_code=403, detail="Username not recognized")
