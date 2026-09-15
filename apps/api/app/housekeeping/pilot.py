"""Pilot workflows: candidate discovery, bulk adoption, CSV round-trip.

The pilot slice: safe categories only (.log/.err under a size threshold,
__pycache__) on /project/cil. Empty files are deliberately NOT a category —
zero-byte pipeline sentinels are functionally critical and look identical
to zero-byte garbage; they stay out until the protection list exists.
Every category predicate therefore includes size_gt: 0.
"""
import csv
import io
import time
from typing import Any

from app.db.clickhouse import get_client
from app.housekeeping import db as hk


def protected_segments() -> list[str]:
    """Active protection-list segments (data-driven; seeded in schema.sql)."""
    with hk.tx() as conn:
        rows = conn.execute(
            "SELECT segment FROM hk_protection WHERE active ORDER BY segment").fetchall()
    return [r[0] for r in rows]


def protection_sql(segments: list[str]) -> tuple[str, dict]:
    """AND-able SQL fragment excluding protected segments, parameterized."""
    conds, params = [], {}
    for i, seg in enumerate(segments):
        params[f"prot{i}"] = f"/{seg}/"
        conds.append(f"position(path, %(prot{i})s) = 0")
    return (" AND " + " AND ".join(conds)) if conds else "", params

# ---------- pattern-based find ----------
# The fixed categories were too rigid (a .log/.err category once swept
# envs/ and pkgs/). Find takes include/exclude NAME patterns + size range
# + age; the old categories live on only as PRESETS that fill the fields.
# Scan, sample and the adopted target all build the SAME resolver
# predicate, so what you saw is exactly what the target selects.

from app.housekeeping.resolver import resolve

FIND_PRESETS = [
    {"key": "logs", "label": "Log files",
     "include": ".log, .err", "exclude": "", "size_min": "", "size_max_mb": "100",
     "min_age_days": "180", "dir_segment": ""},
    {"key": "slurm", "label": "Slurm output",
     "include": "slurm-*.out, slurm-*.err", "exclude": "", "size_min": "", "size_max_mb": "",
     "min_age_days": "180", "dir_segment": ""},
    {"key": "pycache", "label": "__pycache__",
     "include": "", "exclude": "", "size_min": "", "size_max_mb": "",
     "min_age_days": "", "dir_segment": "__pycache__"},
    {"key": "empty", "label": "Empty files (minus sentinels)",
     "include": "", "size_min": "0", "size_max_mb": "0", "min_age_days": "180",
     "dir_segment": "",
     "exclude": "__init__.py, .gitkeep, .keep, _SUCCESS, .done, .ok, .snakemake_timestamp, py.typed"},
]


def build_find_predicate(include: list[str], exclude: list[str],
                         size_min: int | None, size_max: int | None,
                         min_age_days: int | None, dir_segment: str | None) -> dict:
    """One predicate for scan, sample AND the adopted target."""
    pred: dict[str, Any] = {}
    if include:
        pred["include"] = include
    if exclude:
        pred["exclude"] = exclude
    if size_min is not None:
        pred["size_min"] = int(size_min)
    if size_max is not None:
        pred["size_max"] = int(size_max)
    if min_age_days:
        pred["mtime_before"] = int(time.time()) - int(min_age_days) * 86400
    if dir_segment:
        pred["path_segment"] = dir_segment
    if not pred:
        raise ValueError("give at least one condition — a bare find would match the whole tree")
    # Unless the search explicitly reaches for empty files, keep them out:
    # zero-byte sentinels look identical to zero-byte garbage.
    if pred.get("size_min") is None and pred.get("size_max", 1) != 0:
        pred.setdefault("size_min", 1)
    return pred


def find_candidates(root: str, snapshot_date: str, predicate: dict,
                    group_depth: int = 2) -> dict:
    """Headline totals FIRST (over everything, not the truncated list),
    then groups with majority owners. Protections always apply."""
    rq = resolve(root, snapshot_date, root, "subtree", predicate,
                 exclude_segments=protected_segments())
    root_parts = len([p for p in root.split("/") if p])
    take = root_parts + 1 + group_depth  # splitByChar yields a leading ''

    totals = get_client().execute(
        f"SELECT count(), sum(size) FROM filesystem.entries WHERE {rq.where}",
        rq.params)[0]

    sql = f"""
    SELECT grp, argMax(owner, b) AS suggested_owner, sum(b) AS bytes,
           sum(c) AS files, max(b) / sum(b) AS owner_confidence
    FROM (
        SELECT arrayStringConcat(arraySlice(splitByChar('/', path), 1, {take}), '/') AS grp,
               owner, sum(size) AS b, count() AS c
        FROM filesystem.entries WHERE {rq.where}
        GROUP BY grp, owner
    )
    GROUP BY grp
    ORDER BY files DESC
    LIMIT 200
    """
    rows = get_client().execute(sql, rq.params)
    groups = []
    for grp, owner, bytes_, files, conf in rows:
        c = float(conf) if conf == conf and conf != float("inf") else 0.0
        groups.append({
            "path": grp, "suggested_owner": owner,
            "bytes": int(bytes_), "files": int(files),
            "owner_confidence": round(c, 3),
            # below 60% we suggest nothing rather than guess wrong
            "suggest_assignment": c >= 0.6,
        })
    return {
        "total_files": int(totals[0] or 0),
        "total_bytes": int(totals[1] or 0),
        "groups_shown": len(groups),
        "groups_truncated": len(groups) == 200,
        "groups": groups,
    }


def sample_group(root: str, snapshot_date: str, predicate: dict, path: str) -> dict:
    """Everything needed to judge a group BEFORE creating a target:
    20 real paths, the subtree breakdown, and the extension breakdown."""
    rq = resolve(root, snapshot_date, path, "subtree", predicate,
                 exclude_segments=protected_segments())
    ch = get_client()
    take = len([p for p in path.split("/") if p]) + 2
    subtrees = ch.execute(f"""
        SELECT arrayStringConcat(arraySlice(splitByChar('/', path), 1, {take}), '/') AS sub,
               count() AS files, sum(size) AS bytes
        FROM filesystem.entries WHERE {rq.where}
        GROUP BY sub ORDER BY files DESC LIMIT 50""", rq.params)
    exts = ch.execute(f"""
        SELECT if(match(name, '\\.[A-Za-z0-9_]+$'),
                  lower(arrayElement(splitByChar('.', name), -1)), '(none)') AS ext,
               count() AS files, sum(size) AS bytes
        FROM filesystem.entries WHERE {rq.where}
        GROUP BY ext ORDER BY files DESC LIMIT 12""", rq.params)
    samples = ch.execute(
        f"SELECT path, size, modified_time FROM filesystem.entries WHERE {rq.where}"
        " ORDER BY size DESC LIMIT 20", rq.params)
    return {
        "subtrees": [{"path": p_, "files": int(f), "bytes": int(b)} for p_, f, b in subtrees],
        "extensions": [{"ext": e, "files": int(f), "bytes": int(b)} for e, f, b in exts],
        "samples": [{"path": p_, "bytes": int(sz), "mtime": int(m)} for p_, sz, m in samples],
    }


# ---------- CSV round trip ----------

def parse_worklist_csv(text: str) -> tuple[dict, list[dict], list[str]]:
    """Parse an annotated worklist export. Returns (metadata, rows, problems).
    Rows are matched by target_id, never by position."""
    problems: list[str] = []
    meta: dict = {}
    lines = text.splitlines()
    body_start = 0
    for i, line in enumerate(lines):
        if line.startswith("#"):
            body_start = i + 1
            stripped = line.lstrip("#").strip()
            if ":" in stripped:
                k, v = stripped.split(":", 1)
                meta[k.strip()] = v.strip()
        elif line.strip():
            break
        else:
            body_start = i + 1
    if "base_event" not in meta:
        problems.append("missing metadata block (# base_event: ...) — was this file exported by the tool?")
    reader = csv.DictReader(io.StringIO("\n".join(lines[body_start:])))
    rows = []
    for n, row in enumerate(reader, start=1):
        if not (row.get("id") or "").strip():
            continue
        rows.append({"line": n, **{k: (v or "").strip() for k, v in row.items()}})
    if not rows:
        problems.append("no data rows found")
    return meta, rows, problems


VALID_VERDICTS = {"keep", "delete", "quarantine", "archive", "compress", "needs_info", "not_mine"}
