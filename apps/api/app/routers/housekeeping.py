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
from datetime import date, datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.db.clickhouse import get_client
from app.housekeeping import db as hk
from app.housekeeping import manifests as mf
from app.housekeeping import pilot
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


# ---------- manifests & receipts ----------

class ManifestRequest(BaseModel):
    decision_id: int


@router.post("/manifests")
def generate_manifests(body: ManifestRequest, x_user: str | None = Header(default=None)):
    """Generate per-owner executor manifests for a decision (format v1,
    docs/manifest-format.md). One manifest per file owner — execution on
    RCC is per-owner by construction."""
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        row = conn.execute(
            "SELECT d.id, d.verdict, t.id, t.root, t.path, t.scope, t.predicate"
            " FROM decision d JOIN target t ON t.id = d.target_id"
            " WHERE d.id = %s", (body.decision_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="decision not found")
    decision_id, verdict, target_id, root, path, scope, predicate = row
    if verdict not in ("delete", "quarantine", "archive", "compress"):
        raise HTTPException(status_code=422, detail=f"verdict {verdict!r} has nothing to execute")

    snap = _latest_snapshot()
    try:
        rq = resolve(root, snap, path, scope, predicate or {})
    except ResolverError as e:
        raise HTTPException(status_code=422, detail=str(e))

    summaries = mf.generate_manifests(rq, snap, root, target_id, decision_id, actor)

    with hk.tx() as conn:
        hk.write_with_event(conn, actor, "manifests_generated", target_id=target_id,
                            ref_table="decision", ref_id=decision_id,
                            payload={"manifests": summaries, "snapshot": snap})
    _trigger_backup()
    return {"decision_id": decision_id, "snapshot": snap, "manifests": summaries}


@router.get("/manifests/{manifest_id}")
def download_manifest(manifest_id: str):
    m = mf.load_manifest(manifest_id)
    if m is None:
        raise HTTPException(status_code=404, detail="manifest not found")
    return JSONResponse(content=m, headers={
        "Content-Disposition": f"attachment; filename={m['manifest_id']}.json",
    })


@router.post("/receipts")
def upload_receipt(receipt: dict, x_user: str | None = Header(default=None)):
    """The executor's receipt closes the loop: it becomes the execution
    row(s) — nobody clicks 'I did it'. Dry-run receipts are recorded in the
    event log only."""
    problems = mf.validate_receipt(receipt)
    if problems:
        raise HTTPException(status_code=422, detail="; ".join(problems))
    manifest = mf.load_manifest(receipt["manifest_id"])
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"unknown manifest {receipt['manifest_id']}")

    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        executor = str(receipt["executor"]).lower()
        conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING", (executor,))
        exec_ids = []
        if not receipt.get("dry_run"):
            for decision_id in manifest["decision_ids"]:
                row = conn.execute(
                    "INSERT INTO execution (decision_id, executor, owner_uname, manifest_ref, destination_path)"
                    " VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (decision_id, executor, manifest["owner_uname"], manifest["manifest_id"],
                     manifest["quarantine_dir"] if receipt["action"] == "quarantine" else None),
                ).fetchone()
                exec_ids.append(row[0])
            # Quarantine registry: original path recorded per file, so a
            # restore is one reverse rename — not detective work.
            if receipt["action"] == "quarantine" and exec_ids:
                size_by_path = {e["path"]: e["size_bytes"] for e in manifest.get("entries", [])}
                root = manifest["root"]
                qdir = manifest["quarantine_dir"]
                q_rows = [
                    (exec_ids[0], manifest["manifest_id"], o["path"],
                     qdir + o["path"][len(root):], size_by_path.get(o["path"], 0))
                    for o in receipt.get("outcomes", [])
                    if o.get("outcome") == "quarantined"
                ]
                if q_rows:
                    conn.cursor().executemany(
                        "INSERT INTO quarantine_item (execution_id, manifest_id, original_path,"
                        " quarantine_path, size_bytes, expires_at)"
                        " VALUES (%s, %s, %s, %s, %s, now() + interval '30 days')",
                        q_rows)
        hk.write_with_event(
            conn, actor, "receipt_uploaded",
            target_id=manifest["target_ids"][0] if manifest.get("target_ids") else None,
            ref_table="execution", ref_id=exec_ids[0] if exec_ids else None,
            payload={
                "manifest_id": manifest["manifest_id"],
                "action": receipt["action"],
                "dry_run": bool(receipt.get("dry_run")),
                "bytes_freed": receipt.get("bytes_freed", 0),
                "files_removed": receipt.get("files_removed", 0),
                "files_skipped_changed": receipt.get("files_skipped_changed", 0),
                "files_failed": receipt.get("files_failed", 0),
                "execution_ids": exec_ids,
            })
    _trigger_backup()
    return {"execution_ids": exec_ids, "dry_run": bool(receipt.get("dry_run"))}



# ---------- the sweep: whole-tree analysis in one action ----------

class SweepIn(BaseModel):
    root: str
    campaign: str
    min_files: int | None = None      # e.g. 100_000
    min_bytes: int | None = None      # e.g. 5 TiB
    min_age_days: int | None = None   # e.g. 365 — whole subtree unmodified
    group_depth: int = 2              # granularity below root


@router.post("/sweep")
def sweep(body: SweepIn, x_user: str | None = Header(default=None)):
    """One action, whole picture: every directory group beyond the chosen
    thresholds (ANY of them), across all users, becomes a target assigned
    to its majority owner. Output = one worklist, split per person at
    export. Thresholds are yours, not the tool's."""
    if body.root not in ("/project/cil", "/cds3/cil"):
        raise HTTPException(status_code=422, detail="unknown root")
    if not any([body.min_files, body.min_bytes, body.min_age_days]):
        raise HTTPException(status_code=422, detail="set at least one threshold")
    snap = _latest_snapshot()
    ch = get_client()
    take = body.root.count("/") + 1 + body.group_depth
    import time as _time
    cutoff = int(_time.time()) - (body.min_age_days or 0) * 86400

    conds = []
    if body.min_files:
        conds.append(f"files >= {int(body.min_files)}")
    if body.min_bytes:
        conds.append(f"bytes >= {int(body.min_bytes)}")
    if body.min_age_days:
        conds.append(f"newest_mtime < {cutoff}")
    sql = f"""
    SELECT grp, argMax(owner, b) AS major_owner, sum(b) AS bytes, sum(c) AS files,
           max(b) / sum(b) AS conf, max(mx) AS newest_mtime
    FROM (
        SELECT arrayStringConcat(arraySlice(splitByChar('/', path), 1, {take}), '/') AS grp,
               owner, sum(size) AS b, count() AS c, max(modified_time) AS mx
        FROM filesystem.entries
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s)
          AND is_directory = 0 AND position(owner, char(0)) = 0
        GROUP BY grp, owner
    )
    GROUP BY grp
    HAVING {' OR '.join(conds)}
    ORDER BY bytes DESC
    LIMIT 500
    """
    groups = ch.execute(sql, {"snap": snap, "root": body.root, "rootpfx": body.root + "/%"},
                        settings={"max_result_rows": 0, "max_result_bytes": 0,
                                  "max_execution_time": 300})

    created, by_owner = [], {}
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        for grp, owner, bytes_, files, conf, newest in groups:
            conf = float(conf)
            if conf != conf or conf == float("inf"):  # NaN/inf when bytes sum to 0
                conf = 0.0
            existing = conn.execute(
                "SELECT id FROM target WHERE root = %s AND path = %s AND campaign = %s",
                (body.root, grp, body.campaign)).fetchone()
            if existing:
                continue
            path_hash = ch.execute("SELECT toString(cityHash64(%(p)s))", {"p": grp})[0][0]
            row = conn.execute(
                "INSERT INTO target (name, root, path, path_hash, scope, predicate, campaign,"
                " created_by, cached_bytes, cached_files, cached_snapshot)"
                " VALUES (%s, %s, %s, %s, 'subtree', '{}', %s, %s, %s, %s, %s) RETURNING id",
                (f"sweep: {grp.split('/')[-1] or grp}", body.root, grp, path_hash,
                 body.campaign, actor, int(bytes_), int(files), snap)).fetchone()
            assignee = None
            if conf >= 0.6 and owner and owner != "unknown":
                assignee = owner
                conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING", (owner,))
                conn.execute(
                    "INSERT INTO assignment (target_id, assignee, assigned_by) VALUES (%s, %s, %s)",
                    (row[0], owner, actor))
            hk.write_with_event(conn, actor, "target_created", target_id=row[0],
                                ref_table="target", ref_id=row[0],
                                payload={"sweep": body.campaign, "path": grp,
                                         "bytes": int(bytes_), "files": int(files),
                                         "provisional_assignee": assignee})
            created.append({"target_id": row[0], "path": grp, "bytes": int(bytes_),
                            "files": int(files), "assignee": assignee,
                            "owner_confidence": round(conf, 2)})
            k = assignee or "(unassigned — owner unclear or unknown)"
            agg = by_owner.setdefault(k, {"targets": 0, "bytes": 0, "files": 0})
            agg["targets"] += 1
            agg["bytes"] += int(bytes_)
            agg["files"] += int(files)
    _trigger_backup()
    return {"campaign": body.campaign, "snapshot": snap, "created": created,
            "skipped_existing": len(groups) - len(created), "by_owner": by_owner}


# ---------- pilot: candidates, adoption, CSV round-trip, quarantine ----------

@router.get("/candidates")
def candidates(root: str = Query(...), category: str = Query(...),
               group_depth: int = Query(2, ge=1, le=4)):
    if category not in pilot.CATEGORIES:
        raise HTTPException(status_code=422, detail=f"unknown category; known: {list(pilot.CATEGORIES)}")
    snap = _latest_snapshot()
    groups = pilot.discover_candidates(root, category, snap, group_depth)
    return {"snapshot": snap, "category": category,
            "label": pilot.CATEGORIES[category]["label"], "groups": groups}


class AdoptRequest(BaseModel):
    root: str
    category: str
    paths: list[str]
    campaign: str | None = None


@router.post("/candidates/adopt")
def adopt_candidates(body: AdoptRequest, x_user: str | None = Header(default=None)):
    """Turn selected candidate groups into targets, provisionally assigned
    to the majority byte owner (>= 60% confidence; otherwise unassigned —
    a bad suggestion is worse than none)."""
    if body.category not in pilot.CATEGORIES:
        raise HTTPException(status_code=422, detail="unknown category")
    snap = _latest_snapshot()
    predicate = pilot.CATEGORIES[body.category]["predicate"]
    groups = {g["path"]: g for g in pilot.discover_candidates(body.root, body.category, snap, 4)}
    # re-discover at requested paths' own depth: fall back to fresh rollup per path
    created = []
    ch = get_client()
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        for path in body.paths:
            try:
                rq = resolve(body.root, snap, path, "subtree", predicate)
            except ResolverError as e:
                raise HTTPException(status_code=422, detail=f"{path}: {e}")
            files, bytes_ = ch.execute(rollup_sql(rq), rq.params)[0]
            if not files:
                continue
            path_hash = ch.execute("SELECT toString(cityHash64(%(p)s))", {"p": path})[0][0]
            row = conn.execute(
                "INSERT INTO target (name, root, path, path_hash, scope, predicate, campaign,"
                " created_by, cached_bytes, cached_files, cached_snapshot)"
                " VALUES (%s, %s, %s, %s, 'subtree', %s, %s, %s, %s, %s, %s) RETURNING id",
                (f"{body.category}: {path.split('/')[-1] or path}", body.root, path, path_hash,
                 json.dumps(predicate), body.campaign, actor, bytes_ or 0, files or 0, snap),
            ).fetchone()
            target_id = row[0]
            # provisional assignment from majority owner, when confident
            dist = ch.execute(
                "SELECT owner, sum(size) AS b FROM filesystem.entries"
                f" WHERE {rq.where} GROUP BY owner ORDER BY b DESC LIMIT 2", rq.params)
            assignee = None
            if dist:
                total = sum(r[1] for r in dist) or 1
                if dist[0][1] / total >= 0.6 or len(dist) == 1:
                    assignee = dist[0][0]
            if assignee:
                conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING", (assignee,))
                conn.execute(
                    "INSERT INTO assignment (target_id, assignee, assigned_by) VALUES (%s, %s, %s)",
                    (target_id, assignee, actor))
            hk.write_with_event(conn, actor, "target_created", target_id=target_id,
                                ref_table="target", ref_id=target_id,
                                payload={"category": body.category, "path": path,
                                         "bytes": bytes_ or 0, "files": files or 0,
                                         "provisional_assignee": assignee})
            created.append({"target_id": target_id, "path": path, "bytes": bytes_ or 0,
                            "files": files or 0, "assignee": assignee})
    _trigger_backup()
    return {"created": created, "snapshot": snap}


class WorklistUpload(BaseModel):
    csv_text: str
    commit: bool = False


@router.post("/worklist-upload")
def worklist_upload(body: WorklistUpload, x_user: str | None = Header(default=None)):
    """The return leg of the Drive round trip. Classifies every row as
    error / warning / clean, shows the diff, and only applies on
    commit=true. Errors skip that row only; the rest still push."""
    meta, rows, problems = pilot.parse_worklist_csv(body.csv_text)
    if problems and not rows:
        raise HTTPException(status_code=422, detail="; ".join(problems))

    errors, warnings, changes, unchanged = [], [], [], 0
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        for r in rows:
            tid_s = r.get("id", "")
            try:
                tid = int(tid_s)
            except ValueError:
                errors.append({"line": r["line"], "problem": f"bad target id {tid_s!r}"})
                continue
            t = conn.execute(
                "SELECT t.id, d.verdict FROM target t"
                " LEFT JOIN LATERAL (SELECT verdict FROM decision WHERE target_id = t.id"
                "  AND superseded_by IS NULL ORDER BY decided_at DESC LIMIT 1) d ON true"
                " WHERE t.id = %s", (tid,)).fetchone()
            if not t:
                errors.append({"line": r["line"], "problem": f"unknown target id {tid}"})
                continue
            current_verdict = t[1]
            new_verdict = (r.get("new_verdict") or "").lower()
            new_assignee = (r.get("new_assignee") or "").lower()
            if new_verdict and new_verdict not in pilot.VALID_VERDICTS:
                errors.append({"line": r["line"], "problem": f"unparseable verdict {new_verdict!r}"})
                continue
            # changed-underneath detection via row_version vs current events
            rv = r.get("row_version", "")
            cur_rv = conn.execute(
                "SELECT COALESCE(max(id), 0) FROM event WHERE target_id = %s", (tid,)).fetchone()[0]
            if rv and rv.isdigit() and int(rv) != cur_rv:
                warnings.append({"line": r["line"], "target_id": tid,
                                 "problem": f"changed since export (row_version {rv} -> {cur_rv})"})
            if not new_verdict and not new_assignee:
                unchanged += 1
                continue
            if new_verdict and new_verdict == current_verdict and not new_assignee:
                unchanged += 1
                continue
            changes.append({"target_id": tid, "from": current_verdict,
                            "to": new_verdict or current_verdict,
                            "assignee": new_assignee or None,
                            "rationale": r.get("new_rationale") or None})

        applied = []
        if body.commit:
            for c in changes:
                if c["to"] and c["to"] != c["from"]:
                    prev = conn.execute(
                        "SELECT id FROM decision WHERE target_id = %s AND superseded_by IS NULL",
                        (c["target_id"],)).fetchall()
                    row = conn.execute(
                        "INSERT INTO decision (target_id, verdict, rationale, decided_by)"
                        " VALUES (%s, %s, %s, %s) RETURNING id",
                        (c["target_id"], c["to"], c["rationale"], actor)).fetchone()
                    for (old_id,) in prev:
                        conn.execute("UPDATE decision SET superseded_by = %s WHERE id = %s",
                                     (row[0], old_id))
                if c["assignee"]:
                    conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING",
                                 (c["assignee"],))
                    conn.execute(
                        "INSERT INTO assignment (target_id, assignee, assigned_by) VALUES (%s, %s, %s)",
                        (c["target_id"], c["assignee"], actor))
                applied.append(c["target_id"])
            hk.write_with_event(conn, actor, "worklist_uploaded", payload={
                "worklist": meta.get("worklist"), "base_event": meta.get("base_event"),
                "applied": len(applied), "errors": len(errors),
                "warnings": len(warnings), "unchanged": unchanged,
                "changes": changes[:200],
            })
    if body.commit:
        _trigger_backup()
    return {"meta": meta, "errors": errors, "warnings": warnings,
            "changes": changes, "unchanged": unchanged,
            "applied": len(changes) if body.commit else 0, "committed": body.commit}


@router.get("/quarantine")
def quarantine_list(active_only: bool = Query(default=True)):
    """Where everything went: original path, holding path, expiry."""
    with hk.tx() as conn:
        q = ("SELECT id, manifest_id, original_path, quarantine_path, size_bytes,"
             " quarantined_at, expires_at, restored_at, purged_at FROM quarantine_item")
        if active_only:
            q += " WHERE restored_at IS NULL AND purged_at IS NULL"
        q += " ORDER BY expires_at ASC LIMIT 5000"
        rows = conn.execute(q).fetchall()
    cols = ["id", "manifest_id", "original_path", "quarantine_path", "size_bytes",
            "quarantined_at", "expires_at", "restored_at", "purged_at"]
    return [dict(zip(cols, r)) for r in rows]


@router.post("/quarantine/{item_id}/restored")
def mark_restored(item_id: int, x_user: str | None = Header(default=None)):
    """Record that a file was returned (reverse rename done by the owner)."""
    with hk.tx() as conn:
        actor = _actor(x_user, conn)
        row = conn.execute(
            "UPDATE quarantine_item SET restored_at = now()"
            " WHERE id = %s AND restored_at IS NULL AND purged_at IS NULL RETURNING original_path",
            (item_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not found or not active")
        hk.write_with_event(conn, actor, "quarantine_restored", ref_table="quarantine_item",
                            ref_id=item_id, payload={"original_path": row[0]})
    _trigger_backup()
    return {"restored": row[0]}



# ---------- the record: exportable archive + per-path story ----------
# The history is the point of the tool. Both endpoints are designed for a
# reader who was never here: the archive is a single self-describing file
# that needs no app to read; the story answers "what happened to this
# path" for ANY path — including ones that no longer exist, and including
# the honest answer "nobody ever looked at it".

def _ledger_rows(conn) -> list[dict]:
    """Flat chronological ledger, human-readable without the app."""
    rows = conn.execute("""
        SELECT e.at, e.actor, e.kind, e.target_id,
               COALESCE(e.payload->>'path', t.path) AS path,
               e.payload
        FROM event e LEFT JOIN target t ON t.id = e.target_id
        ORDER BY e.id
    """).fetchall()
    out = []
    for at, actor, kind, target_id, path, payload in rows:
        p = payload or {}
        detail = ""
        if kind == "decided":
            detail = f"verdict={p.get('verdict')}"
        elif kind == "dismissed":
            detail = f"note={p.get('note')}"
        elif kind == "receipt_uploaded":
            detail = (f"action={p.get('action')} bytes_freed={p.get('bytes_freed')}"
                      f" removed={p.get('files_removed')} dry_run={p.get('dry_run')}")
        elif kind == "target_created":
            detail = f"bytes={p.get('bytes')} files={p.get('files')}"
        elif kind == "assigned":
            detail = f"assignee={p.get('assignee')}"
        elif kind == "worklist_uploaded":
            detail = f"applied={p.get('applied')} errors={p.get('errors')} warnings={p.get('warnings')}"
        else:
            detail = json.dumps({k: v for k, v in p.items() if k not in ("changes", "manifests")})[:200]
        out.append({"at": str(at), "actor": actor, "action": kind,
                    "target_id": target_id, "path": path or "", "detail": detail})
    return out


@router.get("/archive.json")
def archive_json():
    """The complete record as one self-describing document."""
    with hk.tx() as conn:
        def table(sql):
            cur = conn.execute(sql)
            cols = [d.name for d in cur.description]
            return [dict(zip(cols, [str(v) if hasattr(v, "isoformat") else v for v in r]))
                    for r in cur.fetchall()]
        doc = {
            "_what_is_this": (
                "Complete housekeeping record for the CIL RCC storage cleanup: every "
                "target, decision, dismissal, execution, quarantine movement and note, "
                "with actors and timestamps. Exported so the history survives the "
                "dashboard. The 'ledger' section is the chronological human-readable "
                "summary; the other sections are the full tables."
            ),
            "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ledger": _ledger_rows(conn),
            "targets": table("SELECT * FROM target ORDER BY id"),
            "decisions": table("SELECT * FROM decision ORDER BY id"),
            "assignments": table("SELECT * FROM assignment ORDER BY id"),
            "executions": table("SELECT * FROM execution ORDER BY id"),
            "events": table("SELECT * FROM event ORDER BY id"),
        }
        for opt_table, key in (("hk_dismissal", "dismissals"), ("quarantine_item", "quarantine"),
                               ("hk_list", "lists"), ("hk_list_item", "list_items")):
            try:
                doc[key] = table(f"SELECT * FROM {opt_table} ORDER BY 1")
            except Exception:
                doc[key] = []
    return JSONResponse(content=json.loads(json.dumps(doc, default=str)), headers={
        "Content-Disposition": "attachment; filename=housekeeping-archive.json"})


@router.get("/archive.csv")
def archive_csv():
    """The chronological ledger as flat CSV — openable anywhere, forever."""
    with hk.tx() as conn:
        rows = _ledger_rows(conn)
    buf = io.StringIO()
    buf.write("# CIL RCC housekeeping ledger — every recorded action, chronological.\n")
    buf.write(f"# exported_at: {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ}\n")
    w = csv.DictWriter(buf, fieldnames=["at", "actor", "action", "target_id", "path", "detail"])
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return Response(content=buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=housekeeping-ledger.csv"})


@router.get("/story")
def story(path: str = Query(..., min_length=1)):
    """What happened here — for any path, existing or not. Collects
    everything at, above (covering) or below the path, chronologically.
    An empty result is itself the answer: nobody ever looked at it."""
    p = path.rstrip("/") or "/"
    entries: list[dict] = []

    def rel(other: str) -> str:
        if other == p:
            return "exact"
        if p.startswith(other + "/"):
            return "covers this path"
        return "within this path"

    with hk.tx() as conn:
        args3 = (p, p, p)
        cover = " (path = %s OR %s LIKE path || '/%%' OR path LIKE %s || '/%%')"

        for tid, tpath, tname, tby, tat in conn.execute(
                "SELECT id, path, name, created_by, created_at FROM target WHERE" + cover,
                args3).fetchall():
            entries.append({"at": str(tat), "actor": tby, "kind": "target_created",
                            "path": tpath, "relation": rel(tpath),
                            "summary": f"became worklist target '{tname}' (#{tid})"})
            for did, verdict, rationale, dby, dat, sup in conn.execute(
                    "SELECT id, verdict, rationale, decided_by, decided_at, superseded_by"
                    " FROM decision WHERE target_id = %s ORDER BY decided_at", (tid,)).fetchall():
                entries.append({"at": str(dat), "actor": dby, "kind": "decision",
                                "path": tpath, "relation": rel(tpath),
                                "summary": f"decided '{verdict}'"
                                           + (f" — {rationale}" if rationale else "")
                                           + (" (later superseded)" if sup else "")})
                for ex, eby, eat, vat, vdb in conn.execute(
                        "SELECT manifest_ref, executor, claimed_at, verified_at, verified_delta_bytes"
                        " FROM execution WHERE decision_id = %s", (did,)).fetchall():
                    entries.append({"at": str(eat), "actor": eby, "kind": "execution",
                                    "path": tpath, "relation": rel(tpath),
                                    "summary": f"executed under manifest {ex or '(none)'}"
                                               + (f"; verified {vat}, delta {vdb} bytes" if vat else "; not yet verified by snapshot")})

        try:
            for did_, dpath, note, dby, dat, rat, rby in conn.execute(
                    "SELECT id, path, note, dismissed_by, dismissed_at, revoked_at, revoked_by"
                    " FROM hk_dismissal WHERE" + cover, args3).fetchall():
                entries.append({"at": str(dat), "actor": dby, "kind": "dismissed",
                                "path": dpath, "relation": rel(dpath),
                                "summary": f"reviewed and dismissed — {note}"})
                if rat:
                    entries.append({"at": str(rat), "actor": rby or "?", "kind": "undismissed",
                                    "path": dpath, "relation": rel(dpath),
                                    "summary": "dismissal revoked (back in recon)"})
        except Exception:
            pass

        try:
            for qpath, qdest, qat, qexp, qres, qpur in conn.execute(
                    "SELECT original_path, quarantine_path, quarantined_at, expires_at,"
                    " restored_at, purged_at FROM quarantine_item WHERE"
                    + cover.replace("path", "original_path"), args3).fetchall():
                st = ("restored " + str(qres)[:10] if qres
                      else "purged " + str(qpur)[:10] if qpur
                      else f"in quarantine until {str(qexp)[:10]}")
                entries.append({"at": str(qat), "actor": "", "kind": "quarantined",
                                "path": qpath, "relation": rel(qpath),
                                "summary": f"moved to {qdest} — {st}"})
        except Exception:
            pass

        try:
            for lpath, lname, lby, lat in conn.execute(
                    "SELECT i.path, l.name, i.added_by, i.added_at FROM hk_list_item i"
                    " JOIN hk_list l ON l.id = i.list_id WHERE"
                    + cover.replace("path", "i.path"), args3).fetchall():
                entries.append({"at": str(lat), "actor": lby, "kind": "listed",
                                "path": lpath, "relation": rel(lpath),
                                "summary": f"added to list '{lname}'"})
        except Exception:
            pass

    entries.sort(key=lambda e: e["at"])

    # Existence is a separate question from history — answer both.
    ch = get_client()
    snaps = [str(r[0]) for r in ch.execute(
        "SELECT DISTINCT snapshot_date FROM filesystem.snapshots ORDER BY snapshot_date DESC LIMIT 2")]

    def presence(snap: str) -> dict | None:
        r = ch.execute(
            "SELECT countIf(path = %(p)s), countIf(path != %(p)s),"
            " maxIf(is_directory, path = %(p)s), maxIf(size, path = %(p)s)"
            " FROM filesystem.entries WHERE snapshot_date = %(s)s"
            " AND (path = %(p)s OR path LIKE %(pfx)s)",
            {"s": snap, "p": p, "pfx": p + "/%"})[0]
        exact, under, is_dir, size = int(r[0]), int(r[1]), int(r[2] or 0), int(r[3] or 0)
        if exact == 0 and under == 0:
            return None
        return {"snapshot": snap, "is_directory": bool(is_dir or under), "size": size,
                "children": under}

    cur = presence(snaps[0]) if snaps else None
    prev = presence(snaps[1]) if len(snaps) > 1 else None

    if cur:
        what = ("directory" if cur["is_directory"] else "file")
        state = f"Exists on disk ({what}, snapshot {cur['snapshot']})"
    elif prev:
        state = (f"GONE: present in snapshot {prev['snapshot']} but missing from "
                 f"{snaps[0]}" + (" — and no housekeeping record explains why" if not entries else ""))
    else:
        state = "Never seen in any retained snapshot"

    return {
        "path": p,
        "exists_now": bool(cur),
        "existed_previously": bool(prev),
        "state": state,
        "entries": entries,
        "verdict": (f"{state}; never reviewed, listed, decided on or executed against."
                    if not entries else None),
    }


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
  AND (%(campaign)s::text IS NULL OR t.campaign = %(campaign)s)
  AND (%(assignee)s::text IS NULL OR a.assignee = %(assignee)s)
ORDER BY t.cached_bytes DESC NULLS LAST
"""

COLUMNS = ["id", "name", "root", "path", "scope", "campaign", "bytes", "files",
           "cached_snapshot", "frozen_snapshot", "created_by", "created_at",
           "assignee", "assignment_status", "due_date", "decision_id", "verdict",
           "rationale", "decided_by", "decided_at", "executor", "claimed_at",
           "verified_at", "verified_delta_bytes", "row_version"]


def _report_rows(root: str | None, campaign: str | None = None, assignee: str | None = None):
    with hk.tx() as conn:
        rows = conn.execute(REPORT_SQL, {"root": root, "campaign": campaign,
                                         "assignee": assignee}).fetchall()
    return [dict(zip(COLUMNS, r)) for r in rows]


@router.get("/report")
def report(root: str | None = Query(default=None), campaign: str | None = Query(default=None),
           assignee: str | None = Query(default=None)):
    rows = _report_rows(root, campaign, assignee)
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
def report_csv(root: str | None = Query(default=None), campaign: str | None = Query(default=None),
               assignee: str | None = Query(default=None),
               x_user: str | None = Header(default=None)):
    """Round-trippable export. The metadata block + per-row row_version are
    the identity a future upload validates against: row_version is the
    target's latest event id at export time, so a later upload can detect
    that a row changed underneath the person who exported it."""
    from datetime import datetime, timezone
    rows = _report_rows(root, campaign, assignee)
    with hk.tx() as conn:
        base_event = conn.execute("SELECT COALESCE(max(id), 0) FROM event").fetchone()[0]
    now = datetime.now(timezone.utc)
    exported_by = (x_user or "unknown").strip().lower()
    meta = [
        "# rcc-housekeeping-worklist v1",
        f"# worklist: wl_{now:%Y-%m-%d}_{exported_by}",
        f"# root: {root or 'all'}",
        f"# campaign: {campaign or 'all'}   assignee: {assignee or 'all'}",
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
