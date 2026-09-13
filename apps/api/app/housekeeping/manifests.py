"""Manifest generation + receipt ingestion (format v1).

The canonical format lives in scanner/crates/manifest-types (Rust); this
writer must stay in sync — bump FORMAT_VERSION in both together.

One manifest per owner: execution on RCC is per-owner by construction.
Entries carry size/mtime/inode from the snapshot so the executor can verify
each file is still the one that was reviewed.
"""
import json
import pathlib
import re
import secrets
from datetime import datetime, timezone

from app.db.clickhouse import get_client
from app.housekeeping.resolver import ResolvedQuery

FORMAT_VERSION = 1

MANIFEST_DIR = pathlib.Path("/backups/manifests")


def members_with_meta_sql(rq: ResolvedQuery) -> str:
    """Full member list with everything the executor needs to verify."""
    return (
        "SELECT path, toString(cityHash64(path)) AS path_hash, size,"
        " modified_time, inode, owner"
        f" FROM filesystem.entries WHERE {rq.where}"
        " ORDER BY owner, path"
    )


def generate_manifests(
    rq: ResolvedQuery,
    snapshot_date: str,
    root: str,
    target_id: int,
    decision_id: int,
    generated_by: str,
) -> list[dict]:
    """Resolve the target's members and write one manifest per owner.

    Returns summaries [{manifest_id, owner_uname, files, bytes, path}].
    """
    # Internal service query: the 8000-row guardrail protects interactive
    # users, not manifest generation — a manifest must list EVERY member.
    rows = get_client().execute(
        members_with_meta_sql(rq), rq.params,
        settings={"max_result_rows": 0, "max_result_bytes": 0, "max_execution_time": 300},
    )
    by_owner: dict[str, list] = {}
    excluded_corrupted = 0
    for path, path_hash, size, mtime, inode, owner in rows:
        # Reject-don't-repair: a NUL anywhere in the row means corruption
        # upstream. A corrupted path in a purge manifest is unrecoverable,
        # so such rows are EXCLUDED and counted, never cleaned up.
        if "\x00" in path or "\x00" in (owner or ""):
            excluded_corrupted += 1
            continue
        by_owner.setdefault(owner or "unknown", []).append(
            (path, path_hash, size, mtime, inode)
        )

    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    summaries = []
    for owner, entries in sorted(by_owner.items()):
        safe_owner = re.sub(r"[^A-Za-z0-9_.-]", "_", owner)[:32]
        manifest_id = f"hk-t{target_id}-{safe_owner}-{now:%Y%m%d}-{secrets.token_hex(3)}"
        total_bytes = sum(e[2] for e in entries)
        manifest = {
            "version": FORMAT_VERSION,
            "manifest_id": manifest_id,
            "snapshot_date": snapshot_date,
            "root": root,
            "owner_uname": owner,
            "decision_ids": [decision_id],
            "target_ids": [target_id],
            "quarantine_dir": f"{root}/.hk-quarantine/{safe_owner}/{manifest_id}",
            "how_to_run": [
                "This file lists YOUR files that were reviewed for cleanup. Nothing",
                "happens until you (or the campaign admin, with --delegate) run it.",
                "On a Midway login node:",
                f"  1. cd ~/cil-rcc-storage-tracker/scanner && cargo build --release -p hk-executor  (once)",
                f"  2. ./target/release/hk-executor --manifest {manifest_id}.json            # DRY RUN, shows what would happen",
                f"  3. ./target/release/hk-executor --manifest {manifest_id}.json --quarantine   # reversible move, 30-day grace",
                "  4. send the .receipt.json file back, or upload it in the dashboard.",
                "Files changed since review are skipped automatically. --purge deletes",
                "for real and should only follow an expired quarantine.",
            ],
            "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generated_by": generated_by,
            "total_bytes": total_bytes,
            "total_files": len(entries),
            "entries": [
                {
                    "path": p,
                    "path_hash": h,
                    "size_bytes": sz,
                    "mtime_epoch": mt,
                    "inode": ino,
                    "decision_id": decision_id,
                }
                for p, h, sz, mt, ino in entries
            ],
        }
        out = MANIFEST_DIR / f"{manifest_id}.json"
        tmp = out.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(manifest))
        tmp.rename(out)
        summaries.append({
            "manifest_id": manifest_id,
            "owner_uname": owner,
            "files": len(entries),
            "bytes": total_bytes,
            "path": str(out),
        })
    if excluded_corrupted:
        summaries.append({
            "manifest_id": None,
            "owner_uname": None,
            "files": excluded_corrupted,
            "bytes": 0,
            "path": None,
            "note": f"{excluded_corrupted} row(s) EXCLUDED: embedded NUL (corrupted scan data)",
        })
    return summaries


def load_manifest(manifest_id: str) -> dict | None:
    # manifest_id is generated server-side; still, never join user input
    # into a path without neutering separators
    safe = manifest_id.replace("/", "").replace("..", "")
    f = MANIFEST_DIR / f"{safe}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text())


def validate_receipt(receipt: dict) -> list[str]:
    """Structural validation; returns a list of problems (empty = valid)."""
    problems = []
    if receipt.get("version") != FORMAT_VERSION:
        problems.append(f"unsupported receipt version {receipt.get('version')}")
    for field in ("manifest_id", "executor", "action", "started_at",
                  "finished_at", "outcomes"):
        if field not in receipt:
            problems.append(f"missing field: {field}")
    if receipt.get("action") not in ("quarantine", "purge"):
        problems.append(f"unknown action {receipt.get('action')!r}")
    if not isinstance(receipt.get("outcomes"), list):
        problems.append("outcomes must be a list")
    return problems
