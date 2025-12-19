"""ClickHouse database connection and query utilities."""
from functools import lru_cache
from typing import Any
from clickhouse_driver import Client

from app.settings import get_settings


@lru_cache
def get_client() -> Client:
    """Get cached ClickHouse client with strict settings."""
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
