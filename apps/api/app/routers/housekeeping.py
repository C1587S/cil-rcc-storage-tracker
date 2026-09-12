"""Housekeeping API: targets, assignments, decisions, executions, report.

State lives in Postgres; facts resolve against ClickHouse via the selector
resolver. Every write goes through one transaction that also appends the
audit event. The actor comes from the X-User header (same identity the
login gate validates) and must exist in `person`.
"""
import csv
import io
import json
import subprocess
from datetime import date

from fastapi import APIRouter, Header, HTTPException, Query, Response
from pydantic import BaseModel

from app.db.clickhouse import get_client
from app.housekeeping import db as hk
from app.housekeeping.resolver import (
    ResolverError, members_sql, resolve, rollup_sql,
)

router = APIRouter(prefix="/api/housekeeping", tags=["housekeeping"])

# Archive destination and the headroom below which the archive verdict is
# offered. Derived live from the scan — never a config flag.
ARCHIVE_DESTINATION_ROOT = "/cds3/cil"
ARCHIVE_QUOTA_BYTES = 128000 * 1024**3  # 125 TiB (Cost-Effective block quota)
ARCHIVE_MIN_HEADROOM_BYTES = 5 * 1024**4  # need at least 5 TiB free to offer archive


def _actor(x_user: str | None, conn) -> str:
    if not x_user:
        raise HTTPException(status_code=401, detail="X-User header required")
    username = x_user.strip().lower()
    row = conn.execute("SELECT username FROM person WHERE username = %s", (username,)).fetchone()
    if not row:
        # First sight of a gate-validated user: auto-register.
        conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING", (username,))
    return username


def _latest_snapshot() -> str:
    rows = get_client().execute("SELECT max(snapshot_date) FROM filesystem.snapshots")
    if not rows or not rows[0][0]:
        raise HTTPException(status_code=503, detail="No snapshot in ClickHouse")
    return str(rows[0][0])


def _trigger_backup() -> None:
    """Dump-on-write: pg_dump to the bind-mounted /backups after every state
    change. flock + temp-then-rename so an overlapping cron dump can never
    leave a truncated file. Failure never fails the write — the hourly host
    cron (backup-housekeeping.sh) is the backstop and ships to R2."""
    import os
    if not os.path.isdir("/backups"):
        return
    cmd = (
        "flock /backups/.dump.lock -c '"
        "pg_dump -h \"$POSTGRES_HOST\" -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" "
        "-f /backups/housekeeping-latest.sql.tmp && "
        "mv /backups/housekeeping-latest.sql.tmp /backups/housekeeping-latest.sql'"
    )
    try:
        subprocess.Popen(
            ["bash", "-c", cmd],
            env={**os.environ, "PGPASSWORD": os.environ.get("POSTGRES_PASSWORD", "")},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


# ---------- people ----------

class PersonIn(BaseModel):
    username: str
    display_name: str | None = None
    owner_unames: list[str] = []


@router.get("/people")
def list_people():
    with hk.tx() as conn:
        rows = conn.execute(
            "SELECT username, display_name, owner_unames FROM person ORDER BY username"
        ).fetchall()
    return [{"username": r[0], "display_name": r[1], "owner_unames": r[2]} for r in rows]


@router.post("/people")
def upsert_person(body: PersonIn, x_user: str | None = Header(default=None)):
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        conn.execute(
            "INSERT INTO person (username, display_name, owner_unames) VALUES (%s, %s, %s)"
            " ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name,"
            " owner_unames = EXCLUDED.owner_unames",
            (body.username.lower(), body.display_name, body.owner_unames),
        )
        hk.write_with_event(conn, actor, "person_upserted", payload=body.model_dump())
    return {"ok": True}


# ---------- archive headroom ----------

@router.get("/archive-headroom")
def archive_headroom():
    """Live headroom on the archive destination, with a human-readable
    reason when archiving is unavailable. UI derives verdict enablement
    from this — a greyed-out option must say why."""
    snap = _latest_snapshot()
    rows = get_client().execute(
        "SELECT sum(size) FROM filesystem.entries"
        " WHERE snapshot_date = %(d)s AND (path = %(r)s OR path LIKE %(p)s) AND is_directory = 0",
        {"d": snap, "r": ARCHIVE_DESTINATION_ROOT, "p": ARCHIVE_DESTINATION_ROOT + "/%"},
    )
    used = rows[0][0] or 0
    free = max(0, ARCHIVE_QUOTA_BYTES - used)
    available = free >= ARCHIVE_MIN_HEADROOM_BYTES
    gb = 1024**3
    return {
        "destination": ARCHIVE_DESTINATION_ROOT,
        "quota_bytes": ARCHIVE_QUOTA_BYTES,
        "used_bytes": used,
        "free_bytes": free,
        "archive_available": available,
        "reason": None if available else (
            f"Archive unavailable: {ARCHIVE_DESTINATION_ROOT} has "
            f"{free / gb:,.0f} GB free of {ARCHIVE_QUOTA_BYTES / 1024**4 * 1024 / 1024:,.0f} TiB — "
            f"clean {ARCHIVE_DESTINATION_ROOT} first"
        ),
        "snapshot_date": snap,
    }


# ---------- targets ----------

class TargetIn(BaseModel):
    name: str
    root: str
    path: str
    scope: str = "subtree"
    predicate: dict = {}
    campaign: str | None = None
    freeze: bool = False


@router.post("/targets")
def create_target(body: TargetIn, x_user: str | None = Header(default=None)):
    snap = _latest_snapshot()
    try:
        rq = resolve(body.root, snap, body.path, body.scope, body.predicate)
    except ResolverError as e:
        raise HTTPException(status_code=422, detail=str(e))

    ch = get_client()
    files, bytes_ = ch.execute(rollup_sql(rq), rq.params)[0]
    hash_rows = ch.execute(
        "SELECT toString(cityHash64(%(p)s))", {"p": body.path}
    )
    path_hash = hash_rows[0][0]

    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        row = conn.execute(
            "INSERT INTO target (name, root, path, path_hash, scope, predicate, frozen_snapshot,"
            " campaign, created_by, cached_bytes, cached_files, cached_snapshot)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (body.name, body.root, body.path, path_hash, body.scope, json.dumps(body.predicate),
             snap if body.freeze else None, body.campaign, actor, bytes_ or 0, files or 0, snap),
        ).fetchone()
        target_id = row[0]
        if body.freeze:
            # Materialize members NOW: the pinned snapshot is deleted within days.
            members = ch.execute(members_sql(rq, limit=100000), rq.params)
            conn.cursor().executemany(
                "INSERT INTO target_member (target_id, path, path_hash, size_bytes)"
                " VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                [(target_id, m[0], m[1], m[2]) for m in members],
            )
        hk.write_with_event(conn, actor, "target_created", target_id=target_id,
                            ref_table="target", ref_id=target_id,
                            payload={"name": body.name, "root": body.root, "path": body.path,
                                     "bytes": bytes_ or 0, "files": files or 0,
                                     "frozen": body.freeze})
    _trigger_backup()
    return {"id": target_id, "bytes": bytes_ or 0, "files": files or 0, "snapshot": snap}


# ---------- state changes ----------

class AssignmentIn(BaseModel):
    target_id: int
    assignee: str
    due_date: date | None = None


@router.post("/assignments")
def create_assignment(body: AssignmentIn, x_user: str | None = Header(default=None)):
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING",
                     (body.assignee.lower(),))
        row = conn.execute(
            "INSERT INTO assignment (target_id, assignee, assigned_by, due_date)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (body.target_id, body.assignee.lower(), actor, body.due_date),
        ).fetchone()
        hk.write_with_event(conn, actor, "assigned", target_id=body.target_id,
                            ref_table="assignment", ref_id=row[0],
                            payload={"assignee": body.assignee.lower()})
    _trigger_backup()
    return {"id": row[0]}


class DecisionIn(BaseModel):
    target_id: int
    verdict: str
    rationale: str | None = None
    destination_path: str | None = None


@router.post("/decisions")
def create_decision(body: DecisionIn, x_user: str | None = Header(default=None)):
    if body.verdict == "archive":
        head = archive_headroom()
        if not head["archive_available"]:
            raise HTTPException(status_code=409, detail=head["reason"])
        if not body.destination_path:
            raise HTTPException(status_code=422, detail="archive requires destination_path")
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        prev = conn.execute(
            "SELECT id FROM decision WHERE target_id = %s AND superseded_by IS NULL",
            (body.target_id,),
        ).fetchall()
        row = conn.execute(
            "INSERT INTO decision (target_id, verdict, rationale, decided_by, destination_path)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body.target_id, body.verdict, body.rationale, actor, body.destination_path),
        ).fetchone()
        for (old_id,) in prev:
            conn.execute("UPDATE decision SET superseded_by = %s WHERE id = %s", (row[0], old_id))
        hk.write_with_event(conn, actor, "decided", target_id=body.target_id,
                            ref_table="decision", ref_id=row[0],
                            payload={"verdict": body.verdict, "superseded": [p[0] for p in prev]})
    _trigger_backup()
    return {"id": row[0]}


class ExecutionIn(BaseModel):
    decision_id: int
    owner_uname: str | None = None
    destination_path: str | None = None
    manifest_ref: str | None = None


@router.post("/executions")
def claim_execution(body: ExecutionIn, x_user: str | None = Header(default=None)):
    """A person marks 'I did it'. Verification is passive: the nightly
    rollup diff either shows the bytes gone or it doesn't."""
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        drow = conn.execute("SELECT target_id FROM decision WHERE id = %s",
                            (body.decision_id,)).fetchone()
        if not drow:
            raise HTTPException(status_code=404, detail="decision not found")
        row = conn.execute(
            "INSERT INTO execution (decision_id, executor, owner_uname, destination_path, manifest_ref)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body.decision_id, actor, body.owner_uname, body.destination_path, body.manifest_ref),
        ).fetchone()
        hk.write_with_event(conn, actor, "execution_claimed", target_id=drow[0],
                            ref_table="execution", ref_id=row[0],
                            payload={"decision_id": body.decision_id})
    _trigger_backup()
    return {"id": row[0]}


# ---------- report ----------

REPORT_SQL = """
SELECT t.id, t.name, t.root, t.path, t.scope, t.campaign,
       t.cached_bytes, t.cached_files, t.cached_snapshot, t.frozen_snapshot,
       t.created_by, t.created_at,
       a.assignee, a.status AS assignment_status, a.due_date,
       d.id AS decision_id, d.verdict, d.rationale, d.decided_by, d.decided_at,
       e.executor, e.claimed_at, e.verified_at, e.verified_delta_bytes,
       v.row_version
FROM target t
LEFT JOIN LATERAL (
    SELECT * FROM assignment WHERE target_id = t.id ORDER BY created_at DESC LIMIT 1
) a ON true
LEFT JOIN LATERAL (
    SELECT * FROM decision WHERE target_id = t.id AND superseded_by IS NULL
    ORDER BY decided_at DESC LIMIT 1
) d ON true
LEFT JOIN LATERAL (
    SELECT * FROM execution WHERE decision_id = d.id ORDER BY claimed_at DESC LIMIT 1
) e ON true
CROSS JOIN LATERAL (
    SELECT COALESCE(max(id), 0) AS row_version FROM event WHERE target_id = t.id
) v
WHERE (%(root)s::text IS NULL OR t.root = %(root)s)
ORDER BY t.cached_bytes DESC NULLS LAST
"""

COLUMNS = ["id", "name", "root", "path", "scope", "campaign", "bytes", "files",
           "cached_snapshot", "frozen_snapshot", "created_by", "created_at",
           "assignee", "assignment_status", "due_date", "decision_id", "verdict",
           "rationale", "decided_by", "decided_at", "executor", "claimed_at",
           "verified_at", "verified_delta_bytes", "row_version"]


def _report_rows(root: str | None):
    with hk.tx() as conn:
        rows = conn.execute(REPORT_SQL, {"root": root}).fetchall()
    return [dict(zip(COLUMNS, r)) for r in rows]


@router.get("/report")
def report(root: str | None = Query(default=None)):
    rows = _report_rows(root)
    tb = 1024**4
    headline = {
        "targets": len(rows),
        "assigned_tb": sum((r["bytes"] or 0) for r in rows if r["assignee"]) / tb,
        "decided_tb": sum((r["bytes"] or 0) for r in rows if r["verdict"]) / tb,
        # The gap someone chases every week — a number on screen, not
        # subtraction done in the reader's head.
        "decided_not_executed_tb": sum(
            (r["bytes"] or 0) for r in rows if r["verdict"] and not r["executor"]
        ) / tb,
        "executed_tb": sum((r["bytes"] or 0) for r in rows if r["executor"]) / tb,
        "verified_tb": sum((r["bytes"] or 0) for r in rows if r["verified_at"]) / tb,
    }
    return {"headline": headline, "rows": rows}


@router.get("/report.csv")
def report_csv(root: str | None = Query(default=None),
               x_user: str | None = Header(default=None)):
    """Round-trippable export. The metadata block + per-row row_version are
    the identity a future upload validates against: row_version is the
    target's latest event id at export time, so a later upload can detect
    that a row changed underneath the person who exported it."""
    from datetime import datetime, timezone
    rows = _report_rows(root)
    with hk.tx() as conn:
        base_event = conn.execute("SELECT COALESCE(max(id), 0) FROM event").fetchone()[0]
    now = datetime.now(timezone.utc)
    exported_by = (x_user or "unknown").strip().lower()
    meta = [
        "# rcc-housekeeping-worklist v1",
        f"# worklist: wl_{now:%Y-%m-%d}_{exported_by}",
        f"# root: {root or 'all'}",
        f"# base_event: {base_event}",
        f"# exported_by: {exported_by}   exported_at: {now:%Y-%m-%dT%H:%MZ}",
    ]
    fieldnames = COLUMNS + ["new_verdict", "new_rationale", "new_assignee"]
    buf = io.StringIO()
    buf.write("\n".join(meta) + "\n")
    w = csv.DictWriter(buf, fieldnames=fieldnames)
    w.writeheader()
    for r in rows:
        out = {k: ("" if v is None else v) for k, v in r.items()}
        out.update({"new_verdict": "", "new_rationale": "", "new_assignee": ""})
        w.writerow(out)
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=housekeeping-{now:%Y%m%d}-{exported_by}.csv"},
    )


@router.get("/events")
def events(target_id: int | None = Query(default=None), limit: int = Query(default=200, le=2000)):
    with hk.tx() as conn:
        if target_id is not None:
            rows = conn.execute(
                "SELECT id, at, actor, kind, target_id, payload FROM event"
                " WHERE target_id = %s ORDER BY id DESC LIMIT %s", (target_id, limit)).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, at, actor, kind, target_id, payload FROM event"
                " ORDER BY id DESC LIMIT %s", (limit,)).fetchall()
    return [{"id": r[0], "at": r[1], "actor": r[2], "kind": r[3],
             "target_id": r[4], "payload": r[5]} for r in rows]
