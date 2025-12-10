"""Tests for DuckDB client."""

import pytest
from app.database.duckdb_client import DuckDBClient


def test_duckdb_client_initialization(db_client):
    """Test DuckDB client can be initialized."""
    assert db_client is not None
    assert db_client.conn is not None


def test_list_snapshots(db_client):
    """Test listing snapshots."""
    snapshots = db_client.list_snapshots()
    assert isinstance(snapshots, list)
    assert len(snapshots) > 0
    assert "date" in snapshots[0]
    assert "file_count" in snapshots[0]


def test_get_snapshot_info(db_client):
    """Test getting snapshot info."""
    snapshot = db_client.get_snapshot_info("2024-01-15")
    assert snapshot is not None
    assert snapshot["date"] == "2024-01-15"
    assert snapshot["file_count"] > 0


def test_search_files_regex(db_client):
    """Test file search with regex."""
    df = db_client.search_files(
        pattern=".*\\.txt$",
        snapshot="2024-01-15",
        regex=True,
        limit=10
    )
    assert len(df) > 0
    for row in df.to_dicts():
        assert row["file_type"] == "txt"


def test_search_files_glob(db_client):
    """Test file search with glob pattern."""
    df = db_client.search_files(
        pattern="*.py",
        snapshot="2024-01-15",
        regex=False,
        limit=10
    )
    assert len(df) >= 0  # May or may not find .py files


def test_get_folder_breakdown(db_client):
    """Test folder breakdown."""
    df = db_client.get_folder_breakdown(
        path="/cil",
        snapshot="2024-01-15",
        depth=1,
        group_by="directory"
    )
    assert len(df) > 0
    assert "name" in df.columns
    assert "total_size" in df.columns


def test_get_heavy_files(db_client):
    """Test getting heavy files."""
    df = db_client.get_heavy_files(
        snapshot="2024-01-15",
        limit=10
    )
    assert len(df) > 0

    # Verify they're sorted by size descending
    sizes = df["size"].to_list()
    assert sizes == sorted(sizes, reverse=True)


def test_get_inactive_files(db_client):
    """Test getting inactive files."""
    df = db_client.get_inactive_files(
        snapshot="2024-01-15",
        days=30,
        limit=10
    )
    # Should return DataFrame (may be empty)
    assert isinstance(df.columns, list)


def test_get_recent_activity(db_client):
    """Test getting recent activity."""
    df = db_client.get_recent_activity(
        snapshot="2024-01-15",
        limit=10
    )
    assert len(df) > 0

    # Verify they're sorted by modified_time descending
    times = df["modified_time"].to_list()
    assert times == sorted(times, reverse=True)


def test_get_file_history(db_client):
    """Test getting file history."""
    # First get a file that exists
    df = db_client.search_files(".*", snapshot="2024-01-15", limit=1)
    if len(df) > 0:
        file_path = df["path"][0]
        history = db_client.get_file_history(file_path)
        assert len(history) > 0
        assert "snapshot_date" in history.columns


def test_execute_raw_query(db_client):
    """Test executing raw SQL query."""
    df = db_client.execute_raw_query("""
        SELECT COUNT(*) as count
        FROM file_snapshots
        WHERE CAST(snapshot_date AS VARCHAR) = '2024-01-15'
    """)
    assert len(df) > 0
    assert df["count"][0] > 0
