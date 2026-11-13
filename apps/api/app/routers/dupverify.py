"""Content-verified duplicates (read-only).

Serves results of explicitly requested cil-dupverify runs, imported into
the dupverify_* tables (clickhouse/schema/06_duplicate_verification.sql).
This is a different kind of evidence from /recon/duplicates, which only
matches basename + size from metadata:

  probable   same name and size in the snapshot; contents never read
  verified   distinct files whose full contents hash identically (BLAKE3,
             optionally compared byte for byte) when they were read

A group's latest run is authoritative; only groups whose latest status is
`complete` contribute verified sets. Savings are upper bounds (snapshots,
quotas, compression and links outside the set are not modelled), and a
verified set is evidence for review, never a deletion instruction: nothing
here creates targets, decisions or manifests.

If the tables have not been created yet, every endpoint answers with
`available: false` instead of failing.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.clickhouse import get_client
from app.housekeeping.resolver import KNOWN_ROOTS
from app.security import housekeeping_guard

router = APIRouter(prefix="/api/housekeeping/verified-duplicates", tags=["housekeeping-dupverify"],
                   dependencies=[Depends(housekeeping_guard)])

TABLES = ("dupverify_runs", "dupverify_groups", "dupverify_files", "dupverify_skipped")
PATHS_PER_SET = 200

# Latest run per group. Ties on verified_at are broken by run_id (time-ordered).
# Aliases differ from column names: ClickHouse substitutes aliases into
# other expressions, which would nest aggregates.
LATEST = """
    SELECT gid AS group_id, latest_run AS run_id, latest_status AS status
    FROM (
        SELECT group_id AS gid, argMax(run_id, (verified_at, run_id)) AS latest_run,
               argMax(status, (verified_at, run_id)) AS latest_status
        FROM filesystem.dupverify_groups FINAL
        GROUP BY group_id
    )
"""

# A group belongs to a root when its common directory is inside the root,
# or (for groups spanning wider) when the root is inside it.
IN_ROOT = ("(startsWith(concat(g.common_dir, '/'), %(pfx)s) "
           "OR startsWith(%(pfx)s, concat(g.common_dir, '/')))")

CAVEAT = ("Verified sets are files whose full contents were identical (BLAKE3"
          "{bv}) when read on the date shown; files may have changed since. "
          "Savings are upper bounds: filesystem snapshots, quotas, compression and "
          "hard links outside the set are not modelled. A verified set is evidence "
          "for review, not a deletion instruction: deciding which copy, if any, can "
          "go still goes through the normal Housekeeping review.")


def _check_root(root: str) -> None:
    if root not in KNOWN_ROOTS:
        raise HTTPException(status_code=422, detail=f"unknown root; known: {KNOWN_ROOTS}")


def available(client=None) -> bool:
    client = client or get_client()
    rows = client.execute(
        "SELECT count() FROM system.tables WHERE database = 'filesystem' AND has(%(t)s, name)",
        {"t": list(TABLES)})
    return bool(rows) and int(rows[0][0]) == len(TABLES)


def _current_snapshot(client) -> str | None:
    rows = client.execute("SELECT max(snapshot_date) FROM filesystem.snapshots")
    return str(rows[0][0]) if rows and rows[0][0] else None


def status_summary(root: str, client=None) -> dict:
    client = client or get_client()
    pfx = root.rstrip("/") + "/"
    by_status = client.execute(f"""
        SELECT l.status, count(), sum(g.files_in), sum(g.size * g.files_in)
        FROM ({LATEST}) AS l
        INNER JOIN filesystem.dupverify_groups AS g FINAL
            ON g.group_id = l.group_id AND g.run_id = l.run_id
        WHERE {IN_ROOT}
        GROUP BY l.status
    """, {"pfx": pfx})
    verified = client.execute(f"""
        SELECT count(), sum(set_copies), sum((set_copies - 1) * set_size), max(set_at), min(set_snap), max(set_snap)
        FROM (
            SELECT f.group_id, f.set_blake3, any(f.copies) AS set_copies, any(f.size) AS set_size,
                   any(f.verified_at) AS set_at, any(f.snapshot_date) AS set_snap
            FROM filesystem.dupverify_files AS f FINAL
            WHERE (f.group_id, f.run_id) IN (SELECT group_id, run_id FROM ({LATEST}) WHERE status = 'complete')
            GROUP BY f.group_id, f.set_blake3
            HAVING countIf(startsWith(f.path, %(pfx)s)) > 0
        )
    """, {"pfx": pfx})
    runs = client.execute("""
        SELECT run_id, snapshot_date, scope_id, started_at, finished_at, stopped, groups_complete,
               groups_incomplete, groups_deferred, groups_skipped, groups_not_attempted, files_in,
               duplicate_sets, verified_logical_bytes, verified_allocated_bytes, bytes_read,
               elapsed_s, skipped_by_reason
        FROM filesystem.dupverify_runs FINAL ORDER BY started_at DESC LIMIT 20
    """)
    n, copies, logical, last_at, snap_min, snap_max = verified[0] if verified else (0, 0, 0, None, None, None)
    return {
        "groups": {s: {"groups": int(c), "files": int(f), "bytes": int(b)} for s, c, f, b in by_status},
        "verified": {"sets": int(n or 0), "copies": int(copies or 0), "potential_logical_bytes": int(logical or 0),
                     "last_verified_at": str(last_at) if n else None,
                     "snapshot_dates": [str(snap_min), str(snap_max)] if n else []},
        "runs": [{
            "run_id": r[0], "snapshot_date": str(r[1]), "scope_id": r[2], "started_at": str(r[3]),
            "finished_at": str(r[4]), "stopped": r[5] or None, "groups_complete": int(r[6]),
            "groups_incomplete": int(r[7]), "groups_deferred": int(r[8]), "groups_skipped": int(r[9]),
            "groups_not_attempted": int(r[10]), "files_in": int(r[11]), "duplicate_sets": int(r[12]),
            "verified_logical_bytes": int(r[13]), "verified_allocated_bytes": int(r[14]),
            "bytes_read": int(r[15]), "elapsed_s": float(r[16]), "skipped_by_reason": r[17],
        } for r in runs],
    }


def verified_sets(root: str, min_size: int, limit: int, client=None) -> list[dict]:
    client = client or get_client()
    pfx = root.rstrip("/") + "/"
    rows = client.execute(f"""
        SELECT f.group_id, f.set_blake3, any(f.size) AS set_size, any(f.copies) AS set_copies,
               max(f.byte_verified), max(f.external_links), any(f.snapshot_date), any(f.verified_at),
               any(f.run_id), count() AS n_paths,
               groupArray({PATHS_PER_SET})((f.path, f.owner, f.dev, f.inode, f.nlink, f.allocated_bytes, f.sparse))
        FROM filesystem.dupverify_files AS f FINAL
        WHERE (f.group_id, f.run_id) IN (SELECT group_id, run_id FROM ({LATEST}) WHERE status = 'complete')
          AND f.size >= %(min)s
        GROUP BY f.group_id, f.set_blake3
        HAVING countIf(startsWith(f.path, %(pfx)s)) > 0
        ORDER BY (set_copies - 1) * set_size DESC, set_size DESC
        LIMIT %(limit)s
    """, {"pfx": pfx, "min": min_size, "limit": limit})
    out = []
    for gid, h, size, copies, bv, ext, snap, at, run_id, n_paths, files in rows:
        files = sorted(files, key=lambda x: x[0])
        inodes: dict[tuple[int, int], int] = {}
        for _p, _o, dev, ino, _nl, alloc, _sp in files:
            inodes[(int(dev), int(ino))] = int(alloc)
        allocs = sorted(inodes.values(), reverse=True)
        complete_listing = int(n_paths) <= PATHS_PER_SET
        out.append({
            "group_id": gid, "blake3": h, "size": int(size), "copies": int(copies),
            "byte_verified": bool(bv), "external_links": bool(ext),
            "snapshot_date": str(snap), "verified_at": str(at), "run_id": run_id,
            "potential_logical_bytes": (int(copies) - 1) * int(size),
            # From the listed inodes; omitted when the listing is truncated.
            "potential_allocated_bytes": (sum(allocs) - allocs[0]) if (allocs and complete_listing) else None,
            "paths_total": int(n_paths), "paths_truncated": not complete_listing,
            "owners": sorted({o for _p, o, *_ in files if o}),
            "files": [{"path": p, "owner": o or None, "inode": int(ino), "nlink": int(nl),
                       "allocated_bytes": int(alloc), "sparse": bool(sp),
                       "in_root": p.startswith(pfx)}
                      for p, o, _dev, ino, nl, alloc, sp in files],
        })
    return out


def pending_groups(root: str, status: str, limit: int, client=None) -> list[dict]:
    client = client or get_client()
    pfx = root.rstrip("/") + "/"
    rows = client.execute(f"""
        SELECT g.group_id, g.size, g.status, g.files_in, g.skipped, g.note, g.verified_at,
               g.snapshot_date, g.run_id, s.reasons
        FROM ({LATEST}) AS l
        INNER JOIN filesystem.dupverify_groups AS g FINAL ON g.group_id = l.group_id AND g.run_id = l.run_id
        LEFT JOIN (
            SELECT group_id, run_id, groupArray((reason, n)) AS reasons
            FROM (SELECT group_id, run_id, reason, count() AS n
                  FROM filesystem.dupverify_skipped FINAL GROUP BY group_id, run_id, reason)
            GROUP BY group_id, run_id
        ) AS s ON s.group_id = g.group_id AND s.run_id = g.run_id
        WHERE l.status = %(status)s AND {IN_ROOT}
        ORDER BY g.size * g.files_in DESC
        LIMIT %(limit)s
    """, {"pfx": pfx, "status": status, "limit": limit})
    return [{"group_id": gid, "size": int(sz), "status": st, "files": int(fi), "skipped": int(sk),
             "note": note or None, "verified_at": str(at), "snapshot_date": str(snap), "run_id": run_id,
             "skip_reasons": {r: int(n) for r, n in (reasons or [])}}
            for gid, sz, st, fi, sk, note, at, snap, run_id, reasons in rows]


@router.get("/status")
def status(root: str = Query(...)):
    _check_root(root)
    client = get_client()
    if not available(client):
        return {"available": False, "detail": "No verification results have been imported yet."}
    return {"available": True, "current_snapshot": _current_snapshot(client),
            **status_summary(root, client)}


@router.get("/sets")
def sets(root: str = Query(...), min_size: int = Query(1 << 20, ge=1),
         byte_verified_only: bool = Query(default=False), limit: int = Query(100, ge=1, le=500)):
    _check_root(root)
    client = get_client()
    if not available(client):
        return {"available": False, "rows": []}
    rows = verified_sets(root, min_size, limit, client)
    if byte_verified_only:
        rows = [r for r in rows if r["byte_verified"]]
    return {"available": True, "current_snapshot": _current_snapshot(client), "rows": rows,
            "caveat": CAVEAT.format(bv=", byte-compared where marked")}


@router.get("/pending")
def pending(root: str = Query(...), status: str = Query("incomplete", pattern="^(incomplete|deferred|skipped)$"),
            limit: int = Query(100, ge=1, le=500)):
    """Groups not (fully) verified: stopped by budget/interruption, deferred
    as too large, or with nothing comparable. None of these count as verified."""
    _check_root(root)
    client = get_client()
    if not available(client):
        return {"available": False, "rows": []}
    return {"available": True, "rows": pending_groups(root, status, limit, client)}
