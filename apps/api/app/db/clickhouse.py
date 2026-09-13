"""ClickHouse database connection and query utilities.

clickhouse_driver.Client is NOT thread-safe, and FastAPI serves sync
endpoints from a thread pool. A shared client corrupts its socket under
concurrent requests and every later query dies with "Bad file descriptor"
(found live once the recon panel started issuing parallel queries).
Clients are therefore THREAD-LOCAL, wrapped with one reconnect-and-retry
for dead sockets — safe because everything here is a read (readonly=1).
"""
import threading
from typing import Any

from clickhouse_driver import Client
from clickhouse_driver.errors import NetworkError

from app.settings import get_settings

_tls = threading.local()


def _new_client() -> Client:
    settings = get_settings()
    return Client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        user=settings.clickhouse_user,
        password=settings.clickhouse_password,
        database=settings.clickhouse_database,
        settings={
            "max_execution_time": settings.max_execution_time,
            "max_result_rows": settings.max_result_rows,
            "max_result_bytes": settings.max_result_bytes,
            "readonly": 1,  # Enforce read-only mode
        },
    )


_RETRYABLE = (OSError, EOFError, NetworkError, BrokenPipeError)


class SafeClient:
    """Thread-local, self-healing ClickHouse client facade."""

    def _client(self) -> Client:
        c = getattr(_tls, "client", None)
        if c is None:
            c = _new_client()
            _tls.client = c
        return c

    def _reset(self) -> Client:
        try:
            getattr(_tls, "client", None) and _tls.client.disconnect()
        except Exception:
            pass
        _tls.client = _new_client()
        return _tls.client

    def execute(self, *args, **kwargs):
        try:
            return self._client().execute(*args, **kwargs)
        except _RETRYABLE:
            return self._reset().execute(*args, **kwargs)

    def execute_iter(self, *args, **kwargs):
        try:
            return self._client().execute_iter(*args, **kwargs)
        except _RETRYABLE:
            return self._reset().execute_iter(*args, **kwargs)

    def disconnect(self) -> None:  # compat no-op; lifecycle is per-thread
        pass


_safe = SafeClient()


def get_client() -> SafeClient:
    """Thread-safe ClickHouse access — the only sanctioned entry point."""
    return _safe


def execute_query(query: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    Execute a parameterized query and return results as list of dicts.

    Args:
        query: SQL query with %(param)s placeholders
        params: Dictionary of parameters for query binding

    Returns:
        List of dictionaries representing rows
    """
    client = get_client()

    # Execute query with parameter binding (prevents SQL injection)
    result = client.execute(query, params or {}, with_column_types=True)

    # Unpack result
    rows, columns_with_types = result
    column_names = [col[0] for col in columns_with_types]

    # Convert to list of dicts
    return [dict(zip(column_names, row)) for row in rows]


def execute_query_raw(query: str, params: dict[str, Any] | None = None) -> tuple[list[tuple], list[tuple[str, str]]]:
    """
    Execute a parameterized query and return raw results.

    Args:
        query: SQL query with %(param)s placeholders
        params: Dictionary of parameters for query binding

    Returns:
        Tuple of (rows, columns_with_types)
    """
    client = get_client()
    return client.execute(query, params or {}, with_column_types=True)
