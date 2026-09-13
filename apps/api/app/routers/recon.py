"""Reconnaissance report + custom lists.

Recon answers "where is the problem" BEFORE any rule runs: five views over
the same snapshot (age, directories-by-file-count, owners, largest files,
path detail), each a drill target for the others.

Custom lists are hand-assembled worklists: rows picked from recon, the
tree, or the treemap, minus the things automatic scans wrongly include.
Converting a list creates ordinary targets — same assignment, same CSV
round trip, same manifests. Only the assembly differs.

Honesty note baked into the age endpoint's response: it measures mtime
(last modification anywhere in the subtree). Reading a file does not
update mtime, and atime is unreliable on this mount — "not modified in
two years" is NOT "unused".
"""
import json
import time

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.cache import LRUCache
from app.db.clickhouse import get_client
from app.housekeeping import db as hk
from app.housekeeping.resolver import KNOWN_ROOTS

router = APIRouter(prefix="/api/housekeeping/recon", tags=["housekeeping-recon"])
_cache = LRUCache(maxsize=256)


def _snap() -> str:
    rows = get_client().execute("SELECT max(snapshot_date) FROM filesystem.snapshots")
    if not rows or not rows[0][0]:
        raise HTTPException(status_code=503, detail="No snapshot")
    return str(rows[0][0])


def _check_root(root: str) -> None:
    if root not in KNOWN_ROOTS:
        raise HTTPException(status_code=422, detail=f"unknown root; known: {KNOWN_ROOTS}")


def _cached(key, fn):
    v = _cache.get(key)
    if v is None:
        v = fn()
        _cache.put(key, v)
    return v


def _slashes(s: str) -> int:
    return s.count("/")


CLEAN_OWNER = "position(owner, char(0)) = 0"  # corrupted rows are excluded, never repaired

DISMISS_SCHEMA = """
CREATE TABLE IF NOT EXISTS hk_dismissal (
    id BIGSERIAL PRIMARY KEY,
    root TEXT NOT NULL,
    path TEXT NOT NULL,
    path_hash TEXT NOT NULL,
    note TEXT NOT NULL,
    dismissed_by TEXT NOT NULL,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS hk_dismissal_root_idx ON hk_dismissal (root) WHERE revoked_at IS NULL;
"""


def _active_dismissals(root: str) -> list[dict]:
    with hk.tx() as conn:
        conn.execute(DISMISS_SCHEMA)
        rows = conn.execute(
            "SELECT id, path, note, dismissed_by, dismissed_at FROM hk_dismissal"
            " WHERE root = %s AND revoked_at IS NULL", (root,)).fetchall()
    return [{"id": r[0], "path": r[1], "note": r[2], "by": r[3], "at": str(r[4])} for r in rows]


def _apply_dismissals(rows: list[dict], dismissals: list[dict], include: bool,
                      path_key: str = "path") -> tuple[list[dict], int]:
    """Hide rows at or under any dismissed path. A dismissal covers the
    whole subtree: reviewing a tree once must silence all of it."""
    if not dismissals:
        return rows, 0
    def covering(p: str):
        for d in dismissals:
            if p == d["path"] or p.startswith(d["path"] + "/"):
                return d
        return None
    visible, hidden = [], 0
    for r in rows:
        d = covering(r[path_key])
        if d is None:
            visible.append(r)
        elif include:
            visible.append({**r, "dismissed": {"note": d["note"], "by": d["by"],
                                               "at": d["at"], "id": d["id"]}})
        else:
            hidden += 1
    return visible, hidden


@router.get("/age")
def by_age(root: str = Query(...), min_age_days: int = Query(365, ge=30),
           include_dismissed: bool = Query(default=False)):
    """Coldest MAXIMAL subtrees: directories whose whole tree is older than
    the cutoff but whose parent is not (so each cold tree appears once),
    ranked by the bytes they would free."""
    _check_root(root)
    snap = _snap()
    cutoff = int(time.time()) - min_age_days * 86400

    def run():
        sql = """
        SELECT r.path, r.recursive_size_bytes, r.recursive_file_count, r.last_modified
        FROM filesystem.directory_recursive_sizes AS r
        LEFT JOIN (
            SELECT path, last_modified FROM filesystem.directory_recursive_sizes
            WHERE snapshot_date = %(snap)s AND (path = %(root)s OR path LIKE %(rootpfx)s)
        ) AS p
          ON p.path = arrayStringConcat(arraySlice(splitByChar('/', r.path), 1,
                        length(splitByChar('/', r.path)) - 1), '/')
        WHERE r.snapshot_date = %(snap)s
          AND (r.path = %(root)s OR r.path LIKE %(rootpfx)s)
          AND r.last_modified > 0 AND r.last_modified < %(cutoff)s
          AND (p.path = '' OR p.last_modified >= %(cutoff)s)
        ORDER BY r.recursive_size_bytes DESC
        LIMIT 200
        """
        rows = get_client().execute(sql, {
            "snap": snap, "root": root, "rootpfx": root + "/%", "cutoff": cutoff,
        }, settings={"max_result_rows": 0, "max_result_bytes": 0})
        return [{"path": p, "bytes": int(b), "files": int(f), "last_modified": int(lm)}
                for p, b, f, lm in rows]

    rows, hidden = _apply_dismissals(
        _cached(("age", snap, root, min_age_days), run),
        _active_dismissals(root), include_dismissed)
    return {
        "snapshot": snap, "min_age_days": min_age_days,
        "measures": ("Time since last MODIFICATION (mtime) anywhere in the subtree. "
                     "Reading a file does not update mtime, and atime is unreliable "
                     "on this mount — 'not modified' is NOT 'unused'."),
        "rows": rows, "hidden_dismissed": hidden,
    }


@router.get("/dirs")
def by_directory(root: str = Query(...), include_dismissed: bool = Query(default=False)):
    """Directories holding the most FILES — inode pressure, invisible in
    size-sorted lists. Bytes shown beside counts; the disagreement is the
    interesting part. du-style: a directory and its parent both appear."""
    _check_root(root)
    snap = _snap()
    lo, hi = _slashes(root) + 1, _slashes(root) + 4

    def run():
        sql = """
        SELECT path, direct_file_count, recursive_file_count,
               recursive_size_bytes, last_modified
        FROM filesystem.directory_recursive_sizes
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s)
          AND (length(path) - length(replaceAll(path, '/', ''))) BETWEEN %(lo)s AND %(hi)s
        ORDER BY recursive_file_count DESC
        LIMIT 200
        """
        rows = get_client().execute(sql, {
            "snap": snap, "root": root, "rootpfx": root + "/%", "lo": lo, "hi": hi,
        })
        return [{"path": p, "direct_files": int(df), "files": int(rf),
                 "bytes": int(b), "last_modified": int(lm)}
                for p, df, rf, b, lm in rows]

    rows, hidden = _apply_dismissals(
        _cached(("dirs", snap, root), run), _active_dismissals(root), include_dismissed)
    return {"snapshot": snap, "rows": rows, "hidden_dismissed": hidden}


@router.get("/owners")
def by_owner(root: str = Query(...)):
    _check_root(root)
    snap = _snap()

    def run():
        sql = f"""
        SELECT owner, count() AS files, sum(size) AS bytes
        FROM filesystem.entries
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s)
          AND is_directory = 0 AND {CLEAN_OWNER}
        GROUP BY owner ORDER BY bytes DESC LIMIT 100
        """
        rows = get_client().execute(sql, {"snap": snap, "root": root, "rootpfx": root + "/%"})
        return [{"owner": o, "files": int(f), "bytes": int(b)} for o, f, b in rows]

    return {"snapshot": snap, "rows": _cached(("owners", snap, root), run)}


@router.get("/owner-dirs")
def owner_directories(root: str = Query(...), owner: str = Query(...)):
    """One owner's biggest directory groups — the drill from the owner tab."""
    _check_root(root)
    snap = _snap()
    take = _slashes(root) + 3  # splitByChar yields a leading ''

    def run():
        sql = f"""
        SELECT arrayStringConcat(arraySlice(splitByChar('/', path), 1, {take}), '/') AS grp,
               count() AS files, sum(size) AS bytes, max(modified_time) AS lm
        FROM filesystem.entries
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s)
          AND is_directory = 0 AND owner = %(owner)s
        GROUP BY grp ORDER BY bytes DESC LIMIT 100
        """
        rows = get_client().execute(sql, {
            "snap": snap, "root": root, "rootpfx": root + "/%", "owner": owner,
        })
        return [{"path": g, "files": int(f), "bytes": int(b), "last_modified": int(lm)}
                for g, f, b, lm in rows]

    rows, hidden = _apply_dismissals(
        _cached(("odirs", snap, root, owner), run), _active_dismissals(root), False)
    return {"snapshot": snap, "owner": owner, "rows": rows, "hidden_dismissed": hidden}


@router.get("/largest")
def largest_files(root: str = Query(...)):
    _check_root(root)
    snap = _snap()

    def run():
        sql = f"""
        SELECT path, owner, size, modified_time, created_time
        FROM filesystem.entries
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s)
          AND is_directory = 0 AND {CLEAN_OWNER}
        ORDER BY size DESC LIMIT 200
        """
        rows = get_client().execute(sql, {"snap": snap, "root": root, "rootpfx": root + "/%"})
        return [{"path": p, "owner": o, "bytes": int(s),
                 "last_modified": int(m), "created": int(c)}
                for p, o, s, m, c in rows]

    return {"snapshot": snap, "rows": _cached(("largest", snap, root), run)}


@router.get("/files")
def files_detail(root: str = Query(...), prefix: str = Query(...),
                 owner: str | None = Query(default=None),
                 sort: str = Query("size", pattern="^(size|mtime)$"),
                 limit: int = Query(500, le=2000)):
    """By-path detail: the view the other tabs drill into."""
    _check_root(root)
    if not (prefix == root or prefix.startswith(root + "/")):
        raise HTTPException(status_code=422, detail="prefix must live under root")
    snap = _snap()
    order = "size DESC" if sort == "size" else "modified_time ASC"
    owner_cond = "AND owner = %(owner)s" if owner else ""
    sql = f"""
    SELECT path, owner, size, modified_time, created_time
    FROM filesystem.entries
    WHERE snapshot_date = %(snap)s
      AND (path = %(prefix)s OR path LIKE %(pfx)s)
      AND is_directory = 0 AND {CLEAN_OWNER} {owner_cond}
    ORDER BY {order} LIMIT {int(limit)}
    """
    params = {"snap": snap, "prefix": prefix, "pfx": prefix + "/%"}
    if owner:
        params["owner"] = owner
    rows = get_client().execute(sql, params)
    return {"snapshot": snap, "rows": [
        {"path": p, "owner": o, "bytes": int(s), "last_modified": int(m), "created": int(c)}
        for p, o, s, m, c in rows]}


@router.get("/preview")
def preview(root: str = Query(...), path: str = Query(...)):
    """Everything needed to judge a tree WITHOUT leaving the panel: sample
    paths, extension breakdown, owner mix, date range — plus any standing
    dismissal note on this path or an ancestor."""
    _check_root(root)
    if not (path == root or path.startswith(root + "/")):
        raise HTTPException(status_code=422, detail="path must live under root")
    snap = _snap()

    def run():
        ch = get_client()
        scope = {"snap": snap, "p": path, "pfx": path + "/%"}
        base = ("FROM filesystem.entries WHERE snapshot_date = %(snap)s"
                " AND (path = %(p)s OR path LIKE %(pfx)s) AND is_directory = 0")
        totals = ch.execute(
            f"SELECT count(), sum(size), min(modified_time), max(modified_time) {base}", scope)[0]
        exts = ch.execute(
            f"""SELECT if(match(name, '\\.[A-Za-z0-9_]+$'),
                          lower(arrayElement(splitByChar('.', name), -1)), '(none)') AS ext,
                       count() AS files, sum(size) AS bytes
                {base} GROUP BY ext ORDER BY bytes DESC LIMIT 10""", scope)
        owners = ch.execute(
            f"SELECT owner, count(), sum(size) {base} AND {CLEAN_OWNER}"
            " GROUP BY owner ORDER BY sum(size) DESC LIMIT 5", scope)
        samples = ch.execute(
            f"SELECT path, size, modified_time {base} ORDER BY size DESC LIMIT 8", scope)
        return {
            "files": int(totals[0] or 0), "bytes": int(totals[1] or 0),
            "oldest_mtime": int(totals[2] or 0), "newest_mtime": int(totals[3] or 0),
            "extensions": [{"ext": e, "files": int(f), "bytes": int(b)} for e, f, b in exts],
            "owners": [{"owner": o, "files": int(f), "bytes": int(b)} for o, f, b in owners],
            "samples": [{"path": p, "bytes": int(s_), "mtime": int(m)} for p, s_, m in samples],
        }

    data = dict(_cached(("preview", snap, root, path), run))
    covering = None
    for d in _active_dismissals(root):
        if path == d["path"] or path.startswith(d["path"] + "/"):
            covering = d
            break
    data["dismissal"] = covering
    data["snapshot"] = snap
    return data


class DismissIn(BaseModel):
    root: str
    path: str
    note: str


@router.post("/dismissals")
def dismiss(body: DismissIn, x_user: str | None = Header(default=None)):
    """Reviewed-and-dismissed: the tree stops appearing in recon, and the
    reason sticks to the path for whoever looks next."""
    _check_root(body.root)
    if not body.note.strip():
        raise HTTPException(status_code=422, detail="a dismissal requires a note — future-you needs the reason")
    if not (body.path == body.root or body.path.startswith(body.root + "/")):
        raise HTTPException(status_code=422, detail="path must live under root")
    ph = get_client().execute("SELECT toString(cityHash64(%(p)s))", {"p": body.path})[0][0]
    with hk.tx() as conn:
        conn.execute(DISMISS_SCHEMA)
        actor = _actor(conn, x_user)
        row = conn.execute(
            "INSERT INTO hk_dismissal (root, path, path_hash, note, dismissed_by)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body.root, body.path, ph, body.note.strip(), actor)).fetchone()
        hk.write_with_event(conn, actor, "dismissed", ref_table="hk_dismissal", ref_id=row[0],
                            payload={"path": body.path, "note": body.note.strip()})
    return {"id": row[0]}


@router.delete("/dismissals/{dismissal_id}")
def undismiss(dismissal_id: int, x_user: str | None = Header(default=None)):
    with hk.tx() as conn:
        conn.execute(DISMISS_SCHEMA)
        actor = _actor(conn, x_user)
        row = conn.execute(
            "UPDATE hk_dismissal SET revoked_at = now(), revoked_by = %s"
            " WHERE id = %s AND revoked_at IS NULL RETURNING path",
            (actor, dismissal_id)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="not found or already revoked")
        hk.write_with_event(conn, actor, "undismissed", ref_table="hk_dismissal",
                            ref_id=dismissal_id, payload={"path": row[0]})
    return {"restored_to_recon": row[0]}


@router.get("/dismissals")
def dismissals(root: str = Query(...)):
    _check_root(root)
    return _active_dismissals(root)


# ---------------- custom lists ----------------

LIST_SCHEMA = """
CREATE TABLE IF NOT EXISTS hk_list (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    root TEXT NOT NULL,
    note TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hk_list_item (
    list_id BIGINT NOT NULL REFERENCES hk_list(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    path_hash TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file','dir')),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    files BIGINT NOT NULL DEFAULT 0,
    source TEXT,
    added_by TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, path_hash)
);
"""


def _ensure_list_schema(conn):
    conn.execute(LIST_SCHEMA)


def _actor(conn, x_user: str | None) -> str:
    if not x_user:
        raise HTTPException(status_code=401, detail="X-User header required")
    u = x_user.strip().lower()
    conn.execute("INSERT INTO person (username) VALUES (%s) ON CONFLICT DO NOTHING", (u,))
    return u


class ListIn(BaseModel):
    name: str
    root: str
    note: str | None = None


@router.post("/lists")
def create_list(body: ListIn, x_user: str | None = Header(default=None)):
    if body.root not in KNOWN_ROOTS:
        raise HTTPException(status_code=422, detail="unknown root")
    with hk.tx() as conn:
        _ensure_list_schema(conn)
        actor = _actor(conn, x_user)
        row = conn.execute(
            "INSERT INTO hk_list (name, root, note, created_by) VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (name) DO UPDATE SET note = COALESCE(EXCLUDED.note, hk_list.note)"
            " RETURNING id", (body.name, body.root, body.note, actor)).fetchone()
        hk.write_with_event(conn, actor, "list_created", ref_table="hk_list", ref_id=row[0],
                            payload={"name": body.name, "root": body.root})
    return {"id": row[0]}


@router.get("/lists")
def get_lists():
    with hk.tx() as conn:
        _ensure_list_schema(conn)
        rows = conn.execute(
            "SELECT l.id, l.name, l.root, l.note, l.created_by,"
            " count(i.path_hash), COALESCE(sum(i.size_bytes), 0), COALESCE(sum(i.files), 0)"
            " FROM hk_list l LEFT JOIN hk_list_item i ON i.list_id = l.id"
            " GROUP BY l.id ORDER BY l.created_at DESC").fetchall()
    return [{"id": r[0], "name": r[1], "root": r[2], "note": r[3], "created_by": r[4],
             "items": r[5], "bytes": int(r[6]), "files": int(r[7])} for r in rows]


@router.get("/lists/{list_id}/items")
def list_items(list_id: int):
    with hk.tx() as conn:
        _ensure_list_schema(conn)
        rows = conn.execute(
            "SELECT path, path_hash, kind, size_bytes, files, source, added_by"
            " FROM hk_list_item WHERE list_id = %s ORDER BY size_bytes DESC", (list_id,)).fetchall()
    return [{"path": r[0], "path_hash": r[1], "kind": r[2], "bytes": int(r[3]),
             "files": int(r[4]), "source": r[5], "added_by": r[6]} for r in rows]


class ItemsIn(BaseModel):
    paths: list[str]
    source: str | None = None


@router.post("/lists/{list_id}/items")
def add_items(list_id: int, body: ItemsIn, x_user: str | None = Header(default=None)):
    """Add paths (files or directories). Rollups resolved from the snapshot;
    unknown paths are rejected per-path, not per-request."""
    snap = _snap()
    ch = get_client()
    added, rejected = [], []
    with hk.tx() as conn:
        _ensure_list_schema(conn)
        actor = _actor(conn, x_user)
        lrow = conn.execute("SELECT root FROM hk_list WHERE id = %s", (list_id,)).fetchone()
        if not lrow:
            raise HTTPException(status_code=404, detail="list not found")
        root = lrow[0]
        for path in dict.fromkeys(body.paths):  # dedupe, keep order
            if "\x00" in path or not (path == root or path.startswith(root + "/")):
                rejected.append({"path": path, "reason": "outside list root or corrupted"})
                continue
            meta = ch.execute(
                "SELECT is_directory, size, toString(cityHash64(path)) FROM filesystem.entries"
                " WHERE snapshot_date = %(s)s AND path = %(p)s LIMIT 1",
                {"s": snap, "p": path})
            if not meta:
                rejected.append({"path": path, "reason": "not found in snapshot"})
                continue
            is_dir, size, path_hash = meta[0]
            if is_dir:
                rs = ch.execute(
                    "SELECT recursive_size_bytes, recursive_file_count"
                    " FROM filesystem.directory_recursive_sizes"
                    " WHERE snapshot_date = %(s)s AND path = %(p)s LIMIT 1",
                    {"s": snap, "p": path})
                bytes_, files = (int(rs[0][0]), int(rs[0][1])) if rs else (0, 0)
                kind = "dir"
            else:
                bytes_, files, kind = int(size), 1, "file"
            conn.execute(
                "INSERT INTO hk_list_item (list_id, path, path_hash, kind, size_bytes, files,"
                " source, added_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
                " ON CONFLICT (list_id, path_hash) DO NOTHING",
                (list_id, path, path_hash, kind, bytes_, files, body.source, actor))
            added.append({"path": path, "kind": kind, "bytes": bytes_, "files": files})
        hk.write_with_event(conn, actor, "list_items_added", ref_table="hk_list", ref_id=list_id,
                            payload={"added": len(added), "rejected": len(rejected),
                                     "source": body.source})
    return {"added": added, "rejected": rejected}


@router.delete("/lists/{list_id}/items/{path_hash}")
def remove_item(list_id: int, path_hash: str, x_user: str | None = Header(default=None)):
    with hk.tx() as conn:
        _ensure_list_schema(conn)
        actor = _actor(conn, x_user)
        row = conn.execute(
            "DELETE FROM hk_list_item WHERE list_id = %s AND path_hash = %s RETURNING path",
            (list_id, path_hash)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="item not found")
        hk.write_with_event(conn, actor, "list_item_removed", ref_table="hk_list", ref_id=list_id,
                            payload={"path": row[0]})
    return {"removed": row[0]}


@router.post("/lists/{list_id}/to-worklist")
def list_to_worklist(list_id: int, x_user: str | None = Header(default=None)):
    """Convert a list into ordinary targets (dir items -> subtree targets,
    file items -> single_file targets), campaign = the list name. From here
    it is exactly an automatic worklist: assignment, CSV, manifests."""
    snap = _snap()
    ch = get_client()
    created = []
    with hk.tx() as conn:
        _ensure_list_schema(conn)
        actor = _actor(conn, x_user)
        lrow = conn.execute("SELECT name, root FROM hk_list WHERE id = %s", (list_id,)).fetchone()
        if not lrow:
            raise HTTPException(status_code=404, detail="list not found")
        name, root = lrow
        items = conn.execute(
            "SELECT path, path_hash, kind, size_bytes, files FROM hk_list_item"
            " WHERE list_id = %s", (list_id,)).fetchall()
        if not items:
            raise HTTPException(status_code=422, detail="list is empty")
        for path, path_hash, kind, size_bytes, files in items:
            scope = "subtree" if kind == "dir" else "single_file"
            row = conn.execute(
                "INSERT INTO target (name, root, path, path_hash, scope, predicate, campaign,"
                " created_by, cached_bytes, cached_files, cached_snapshot)"
                " VALUES (%s, %s, %s, %s, %s, '{}', %s, %s, %s, %s, %s) RETURNING id",
                (f"{name}: {path.split('/')[-1] or path}", root, path, path_hash, scope,
                 name, actor, size_bytes, files, snap)).fetchone()
            created.append({"target_id": row[0], "path": path})
        hk.write_with_event(conn, actor, "list_converted", ref_table="hk_list", ref_id=list_id,
                            payload={"targets": [c["target_id"] for c in created], "name": name})
    return {"created": created, "campaign": name}
