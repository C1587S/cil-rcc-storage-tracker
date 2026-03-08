"""Feedback router — simple JSON-file-backed comments with threads."""
import json
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

FEEDBACK_FILE = Path("/app/data/feedback.json")

# In-memory cache — avoids re-reading JSON file on every GET
_cache: dict[str, object] = {"data": None, "tree": None}


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
        return json.loads(FEEDBACK_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return []


def _write_feedback(entries: list[dict]) -> None:
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    FEEDBACK_FILE.write_text(json.dumps(entries, indent=2))
    _cache["data"] = None  # invalidate cache
    _cache["tree"] = None


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


def _find_and_remove(entries: list[dict], entry_id: str, username: str) -> bool:
    """Find and remove an entry and all its descendants."""
    for e in entries:
        if e["id"] == entry_id:
            if e["username"] != username:
                raise HTTPException(403, "You can only delete your own comments")
            to_remove = {entry_id} | _collect_descendants(entries, entry_id)
            entries[:] = [x for x in entries if x["id"] not in to_remove]
            return True
    return False


@router.get("")
async def get_feedback() -> list[FeedbackEntry]:
    if _cache["tree"] is not None:
        return _cache["tree"]
    flat = await asyncio.to_thread(_read_feedback)
    tree = _build_tree(flat)
    result = [FeedbackEntry(**e) for e in tree]
    _cache["tree"] = result
    return result


@router.post("", status_code=201)
async def post_feedback(req: FeedbackRequest) -> FeedbackEntry:
    entry = {
        "id": uuid4().hex[:12],
        "username": req.username.strip(),
        "message": req.message.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "parent_id": req.parent_id,
    }

    def _append():
        entries = _read_feedback()
        if req.parent_id:
            # Validate parent exists
            if not any(e["id"] == req.parent_id for e in entries):
                raise HTTPException(404, "Parent comment not found")
        entries.append(entry)
        _write_feedback(entries)

    await asyncio.to_thread(_append)
    return FeedbackEntry(**entry)


@router.delete("/{feedback_id}", status_code=204)
async def delete_feedback(feedback_id: str, username: str) -> None:
    """Delete a feedback entry and its replies (only the author can delete)."""
    def _delete():
        entries = _read_feedback()
        if not _find_and_remove(entries, feedback_id, username):
            raise HTTPException(404, "Comment not found")
        _write_feedback(entries)

    await asyncio.to_thread(_delete)
