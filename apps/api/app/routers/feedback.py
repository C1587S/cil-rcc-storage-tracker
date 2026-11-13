"""Feedback router — simple JSON-file-backed comments with threads.

Deleting: the username shown on a comment is a label anyone can type, so
it cannot authorize a delete. Posting returns a one-time random
delete_token (only its SHA-256 is stored). Deleting needs that token
(kept by the posting browser) or the operator key.
"""
import hashlib
import hmac
import json
import asyncio
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.security import is_operator, normalize_username

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

FEEDBACK_FILE = Path("/app/data/feedback.json")
MAX_ENTRIES = 5000

# In-memory cache — avoids re-reading JSON file on every GET
_cache: dict[str, object] = {"data": None, "tree": None}
# Serializes read-modify-write so concurrent posts cannot drop each other.
_write_lock = threading.Lock()


class FeedbackEntry(BaseModel):
    id: str
    username: str
    message: str
    created_at: str  # ISO 8601
    parent_id: str | None = None
    replies: list["FeedbackEntry"] = []


class FeedbackRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    message: str = Field(..., min_length=1, max_length=2000)
    parent_id: str | None = None


def _read_feedback() -> list[dict]:
    if not FEEDBACK_FILE.exists():
        return []
    try:
        data = json.loads(FEEDBACK_FILE.read_text())
    except (json.JSONDecodeError, OSError) as e:
        # Never treat an unreadable file as empty: the next write would
        # replace every stored comment with just the new one.
        raise HTTPException(503, "Feedback storage is unreadable; not modifying it") from e
    if not isinstance(data, list):
        raise HTTPException(503, "Feedback storage has an unexpected format")
    return data


def _write_feedback(entries: list[dict]) -> None:
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = FEEDBACK_FILE.with_name(FEEDBACK_FILE.name + ".tmp")
    tmp.write_text(json.dumps(entries, indent=2))
    os.replace(tmp, FEEDBACK_FILE)  # atomic: readers never see a partial file
    _cache["data"] = None  # invalidate cache
    _cache["tree"] = None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public(entry: dict) -> dict:
    return {k: v for k, v in entry.items() if k != "delete_token_hash"}


def _find_root(by_id: dict[str, dict], entry: dict) -> str | None:
    """Walk up parent_id chain to find the root comment id."""
    seen = set()
    current = entry
    while current.get("parent_id") and current["parent_id"] in by_id:
        if current["parent_id"] in seen:
            break
        seen.add(current["parent_id"])
        current = by_id[current["parent_id"]]
    return current["id"]


def _build_tree(flat: list[dict]) -> list[dict]:
    """Build flat threads: root comments with one level of replies (no deeper nesting)."""
    by_id: dict[str, dict] = {}
    roots: list[dict] = []

    for e in flat:
        by_id[e["id"]] = e

    for e in flat:
        e["replies"] = []

    # Attach all replies (regardless of depth) to their root comment
    for e in flat:
        if e.get("parent_id") and e["parent_id"] in by_id:
            root_id = _find_root(by_id, e)
            if root_id != e["id"]:
                by_id[root_id]["replies"].append(e)
            else:
                roots.append(e)
        else:
            roots.append(e)

    return roots


def _flatten_tree(roots: list[dict]) -> list[dict]:
    """Flatten nested tree back to a flat list (for storage)."""
    result: list[dict] = []
    for root in roots:
        replies = root.pop("replies", [])
        result.append(root)
        result.extend(_flatten_tree(replies))
    return result


def _collect_descendants(entries: list[dict], parent_id: str) -> set[str]:
    """Collect all descendant IDs of a given parent."""
    ids = set()
    for e in entries:
        if e.get("parent_id") == parent_id:
            ids.add(e["id"])
            ids |= _collect_descendants(entries, e["id"])
    return ids


def _find_and_remove(entries: list[dict], entry_id: str, token: str | None, operator: bool) -> bool:
    """Remove an entry and its descendants if the caller may delete it."""
    for e in entries:
        if e["id"] == entry_id:
            stored = e.get("delete_token_hash")
            owner_ok = bool(token and stored and hmac.compare_digest(_hash_token(token), stored))
            if not (owner_ok or operator):
                raise HTTPException(403, "Only the browser that posted this comment can delete it")
            to_remove = {entry_id} | _collect_descendants(entries, entry_id)
            entries[:] = [x for x in entries if x["id"] not in to_remove]
            return True
    return False


class PostedFeedback(FeedbackEntry):
    """Returned once on creation; delete_token is never shown again."""
    delete_token: str


@router.get("")
async def get_feedback() -> list[FeedbackEntry]:
    if _cache["tree"] is not None:
        return _cache["tree"]
    flat = [_public(e) for e in await asyncio.to_thread(_read_feedback)]
    tree = _build_tree(flat)
    result = [FeedbackEntry(**e) for e in tree]
    _cache["tree"] = result
    return result


@router.post("", status_code=201)
async def post_feedback(req: FeedbackRequest) -> PostedFeedback:
    username = normalize_username(req.username)
    if username is None:
        raise HTTPException(400, "Invalid username")
    message = req.message.strip()
    if not message:
        raise HTTPException(400, "Message required")
    token = secrets.token_urlsafe(24)
    entry = {
        "id": uuid4().hex[:12],
        "username": username,
        "message": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "parent_id": req.parent_id,
        "delete_token_hash": _hash_token(token),
    }

    def _append():
        with _write_lock:
            entries = _read_feedback()
            if len(entries) >= MAX_ENTRIES:
                raise HTTPException(507, "Feedback storage is full")
            if req.parent_id:
                # Validate parent exists
                if not any(e["id"] == req.parent_id for e in entries):
                    raise HTTPException(404, "Parent comment not found")
            entries.append(entry)
            _write_feedback(entries)

    await asyncio.to_thread(_append)
    return PostedFeedback(**_public(entry), delete_token=token)


@router.delete("/{feedback_id}", status_code=204)
async def delete_feedback(request: Request, feedback_id: str,
                          x_delete_token: str | None = Header(default=None)) -> None:
    """Delete a feedback entry and its replies: the posting browser's
    delete token, or the operator key. The shown username is not checked."""
    operator = is_operator(request)

    def _delete():
        with _write_lock:
            entries = _read_feedback()
            if not _find_and_remove(entries, feedback_id, x_delete_token, operator):
                raise HTTPException(404, "Comment not found")
            _write_feedback(entries)

    await asyncio.to_thread(_delete)
