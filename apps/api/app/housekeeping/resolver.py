"""Selector resolver: the load-bearing piece of housekeeping.

Turns (root, snapshot, path, scope, predicate) into parameterized ClickHouse
SQL. Everything else — rollups, worklists, member lists, frozen-target
materialization — calls this. Nothing else builds SQL against entries.

Design rules:
- `root` is part of the SIGNATURE, not the predicate: a target can never
  accidentally resolve across storage roots (/project/cil vs /cds3/cil are
  different physical filesystems; inode spaces, quotas and campaigns differ).
- All user values travel as bound parameters, never interpolated.
- Paths are matched with an exact-or-prefix pair, never a bare LIKE 'x%'
  (which would also match sibling paths like /cds3/cil-old).
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

KNOWN_ROOTS = ("/project/cil", "/cds3/cil")

# Predicate keys accepted from clients; anything else is rejected loudly.
ALLOWED_PREDICATE_KEYS = {
    "ext", "name", "owner", "size_lt", "size_gt", "mtime_before", "mtime_after",
    # files living under a directory with this exact name anywhere in the
    # subtree (e.g. "__pycache__")
    "path_segment",
}


class ResolverError(ValueError):
    pass


@dataclass
class ResolvedQuery:
    """A parameterized query pair: WHERE clause + params, ready to embed."""
    where: str
    params: dict[str, Any] = field(default_factory=dict)


def _to_epoch(value: str | int) -> int:
    if isinstance(value, int):
        return value
    try:
        return int(datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    except ValueError as e:
        raise ResolverError(f"Bad date {value!r}: use YYYY-MM-DD or epoch seconds") from e


def resolve(
    root: str,
    snapshot_date: str | date,
    path: str,
    scope: str = "subtree",
    predicate: dict[str, Any] | None = None,
    exclude_segments: list[str] | None = None,
) -> ResolvedQuery:
    """Build the WHERE clause selecting this target's member FILES.

    exclude_segments: protected directory names (from the hk_protection
    table) that must never match, applied at RESOLUTION time so category
    targets, sweeps and MANIFEST GENERATION all honor them — a protection
    added after a target was adopted still protects its future manifests.
    """
    if root not in KNOWN_ROOTS:
        raise ResolverError(f"Unknown root {root!r}; known: {KNOWN_ROOTS}")
    if not (path == root or path.startswith(root + "/")):
        raise ResolverError(f"Path {path!r} is not under root {root!r}")
    if scope not in ("subtree", "shallow", "single_file", "query"):
        raise ResolverError(f"Unknown scope {scope!r}")

    predicate = dict(predicate or {})
    unknown = set(predicate) - ALLOWED_PREDICATE_KEYS
    if unknown:
        raise ResolverError(f"Unknown predicate keys: {sorted(unknown)}")

    params: dict[str, Any] = {"snapshot_date": str(snapshot_date), "tpath": path}
    conds = ["snapshot_date = %(snapshot_date)s"]

    if scope == "single_file":
        conds.append("path = %(tpath)s")
    elif scope == "shallow":
        # direct children only (files directly inside the directory)
        conds.append("parent_path = %(tpath)s")
        conds.append("is_directory = 0")
    else:  # subtree, query
        params["tprefix"] = path + "/%"
        conds.append("(path = %(tpath)s OR path LIKE %(tprefix)s)")
        conds.append("is_directory = 0")

    if "ext" in predicate:
        exts = predicate["ext"]
        if not isinstance(exts, list) or not exts:
            raise ResolverError("ext must be a non-empty list of extensions")
        ors = []
        for i, ext in enumerate(exts):
            if not isinstance(ext, str) or not ext.startswith("."):
                raise ResolverError(f"Extension {ext!r} must start with '.'")
            params[f"ext{i}"] = ext
            ors.append(f"endsWith(path, %(ext{i})s)")
        conds.append("(" + " OR ".join(ors) + ")")

    if "name" in predicate:
        params["fname"] = predicate["name"]
        conds.append("name = %(fname)s")

    if "owner" in predicate:
        owners = predicate["owner"]
        if not isinstance(owners, list) or not owners:
            raise ResolverError("owner must be a non-empty list of unames")
        params["owners"] = owners
        conds.append("owner IN %(owners)s")

    if "path_segment" in predicate:
        seg = predicate["path_segment"]
        if not isinstance(seg, str) or "/" in seg or not seg:
            raise ResolverError("path_segment must be a plain directory name")
        params["pseg"] = f"/{seg}/"
        conds.append("position(path, %(pseg)s) > 0")

    if "size_lt" in predicate:
        params["size_lt"] = int(predicate["size_lt"])
        conds.append("size < %(size_lt)s")
    if "size_gt" in predicate:
        params["size_gt"] = int(predicate["size_gt"])
        conds.append("size > %(size_gt)s")

    if "mtime_before" in predicate:
        params["mtime_before"] = _to_epoch(predicate["mtime_before"])
        conds.append("modified_time < %(mtime_before)s")
    if "mtime_after" in predicate:
        params["mtime_after"] = _to_epoch(predicate["mtime_after"])
        conds.append("modified_time > %(mtime_after)s")

    for i, seg in enumerate(exclude_segments or []):
        if not isinstance(seg, str) or "/" in seg or not seg:
            raise ResolverError(f"protected segment {seg!r} must be a plain directory name")
        params[f"prot{i}"] = f"/{seg}/"
        conds.append(f"position(path, %(prot{i})s) = 0")

    return ResolvedQuery(where=" AND ".join(conds), params=params)


def rollup_sql(rq: ResolvedQuery) -> str:
    """Aggregate bytes/files for a resolved target."""
    return (
        "SELECT count() AS files, sum(size) AS bytes"
        f" FROM filesystem.entries WHERE {rq.where}"
    )


def members_sql(rq: ResolvedQuery, limit: int = 1000) -> str:
    """Member file list, largest first. cityHash64 is THE path hash —
    computed here so Postgres and ClickHouse can never disagree."""
    return (
        "SELECT path, toString(cityHash64(path)) AS path_hash, size, owner, modified_time"
        f" FROM filesystem.entries WHERE {rq.where}"
        f" ORDER BY size DESC LIMIT {int(limit)}"
    )


def owner_distribution_sql(rq: ResolvedQuery) -> str:
    return (
        "SELECT owner, count() AS files, sum(size) AS bytes"
        f" FROM filesystem.entries WHERE {rq.where}"
        " GROUP BY owner ORDER BY bytes DESC LIMIT 25"
    )
