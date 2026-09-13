"""Postgres access for housekeeping state.

One pool, schema applied idempotently at startup. Every state change MUST go
through `write_with_event` so the event row lands in the same transaction.
"""
import json
import os
import pathlib
from contextlib import contextmanager

from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None

SCHEMA_PATH = pathlib.Path(__file__).parent / "schema.sql"


def _conninfo() -> str:
    return (
        f"host={os.environ.get('POSTGRES_HOST', 'localhost')} "
        f"port={os.environ.get('POSTGRES_PORT', '5432')} "
        f"dbname={os.environ.get('POSTGRES_DB', 'housekeeping')} "
        f"user={os.environ.get('POSTGRES_USER', 'housekeeping')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'housekeeping')}"
    )


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(_conninfo(), min_size=1, max_size=8, open=True)
        with _pool.connection() as conn:
            conn.execute(SCHEMA_PATH.read_text())
    return _pool


@contextmanager
def tx():
    """A transaction: commits on success, rolls back on exception."""
    with get_pool().connection() as conn:
        with conn.transaction():
            yield conn


def write_with_event(conn, actor: str, kind: str, target_id=None,
                     ref_table=None, ref_id=None, payload=None):
    """Append the audit event inside the caller's open transaction."""
    conn.execute(
        "INSERT INTO event (actor, kind, target_id, ref_table, ref_id, payload)"
        " VALUES (%s, %s, %s, %s, %s, %s)",
        (actor, kind, target_id, ref_table, ref_id, json.dumps(payload or {})),
    )
