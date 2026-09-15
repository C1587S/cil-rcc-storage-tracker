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

# Category definitions. Each yields a resolver-compatible predicate so an
# adopted target re-resolves identically forever.
LOG_SIZE_THRESHOLD = 100 * 1024 * 1024  # only "small" logs in the pilot

CATEGORIES: dict[str, dict[str, Any]] = {
    "logs": {
        "label": ".log / .err files under 100 MB",
        "predicate": {"ext": [".log", ".err"], "size_lt": LOG_SIZE_THRESHOLD, "size_gt": 0},
        "sql": (
            "is_directory = 0 AND (endsWith(path, '.log') OR endsWith(path, '.err'))"
            f" AND size < {LOG_SIZE_THRESHOLD} AND size > 0"
        ),
    },
    "pycache": {
        "label": "__pycache__ contents",
        "predicate": {"path_segment": "__pycache__", "size_gt": 0},
        "sql": "is_directory = 0 AND position(path, '/__pycache__/') > 0 AND size > 0",
    },
}


def category_conditions(category: str, min_age_days: int | None,
                        segments: list[str]) -> tuple[str, dict]:
    """The full WHERE fragment for a category scan: category SQL + optional
    minimum age + the protection list."""
    cat = CATEGORIES[category]
    prot_sql, params = protection_sql(segments)
    age_sql = ""
    if min_age_days:
        params["age_cutoff"] = int(time.time()) - int(min_age_days) * 86400
        age_sql = " AND modified_time < %(age_cutoff)s"
    return cat["sql"] + age_sql + prot_sql, params


def category_predicate(category: str, min_age_days: int | None) -> dict:
    """Resolver predicate for an adopted target — must select the same set
    the scan showed (protections apply at resolution time separately)."""
    pred = dict(CATEGORIES[category]["predicate"])
    if min_age_days:
        pred["mtime_before"] = int(time.time()) - int(min_age_days) * 86400
    return pred


def discover_candidates(root: str, category: str, snapshot_date: str,
                        group_depth: int = 2,
                        min_age_days: int | None = None) -> dict:
    """Category scan: headline totals FIRST (computed over everything, not
    the truncated group list), then groups with majority owners."""
    cond, extra = category_conditions(category, min_age_days, protected_segments())
    root_parts = len([p for p in root.split("/") if p])
    take = root_parts + 1 + group_depth  # splitByChar yields a leading ''
    base_params = {"snap": snapshot_date, "root": root, "rootpfx": root + "/%", **extra}

    totals = get_client().execute(f"""
        SELECT count(), sum(size) FROM filesystem.entries
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s) AND {cond}
    """, base_params)[0]

    sql = f"""
    SELECT grp, argMax(owner, b) AS suggested_owner, sum(b) AS bytes,
           sum(c) AS files, max(b) / sum(b) AS owner_confidence
    FROM (
        SELECT arrayStringConcat(arraySlice(splitByChar('/', path), 1, {take}), '/') AS grp,
               owner, sum(size) AS b, count() AS c
        FROM filesystem.entries
        WHERE snapshot_date = %(snap)s
          AND (path = %(root)s OR path LIKE %(rootpfx)s)
          AND {cond}
        GROUP BY grp, owner
    )
    GROUP BY grp
    HAVING files > 0
    ORDER BY bytes DESC
    LIMIT 200
    """
    rows = get_client().execute(sql, base_params)
    groups = [
        {
            "path": grp,
            "suggested_owner": owner,
            "bytes": int(bytes_),
            "files": int(files),
            # below 60% we suggest nothing rather than guess wrong
            "owner_confidence": round(float(conf), 3) if conf == conf else 0.0,
            "suggest_assignment": (float(conf) if conf == conf else 0.0) >= 0.6,
        }
        for grp, owner, bytes_, files, conf in rows
    ]
    return {
        "total_files": int(totals[0] or 0),
        "total_bytes": int(totals[1] or 0),
        "groups_shown": len(groups),
        "groups_truncated": len(groups) == 200,
        "groups": groups,
    }


def preview_group(root: str, category: str, snapshot_date: str, path: str,
                  min_age_days: int | None = None) -> list[dict]:
    """What adopting this group would sweep, broken down by next-level
    subtree — the 'envs/ 5 files next to logs/ 380,000 files' view that
    catches a bad category BEFORE adoption."""
    cond, extra = category_conditions(category, min_age_days, protected_segments())
    take = len([p for p in path.split("/") if p]) + 2  # one level below the group
    sql = f"""
    SELECT arrayStringConcat(arraySlice(splitByChar('/', path), 1, {take}), '/') AS sub,
           count() AS files, sum(size) AS bytes, max(modified_time) AS newest
    FROM filesystem.entries
    WHERE snapshot_date = %(snap)s
      AND (path = %(p)s OR path LIKE %(pfx)s) AND {cond}
    GROUP BY sub ORDER BY files DESC LIMIT 50
    """
    rows = get_client().execute(sql, {
        "snap": snapshot_date, "p": path, "pfx": path + "/%", **extra})
    return [{"path": sub, "files": int(f), "bytes": int(b), "newest_mtime": int(nm)}
            for sub, f, b, nm in rows]


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
