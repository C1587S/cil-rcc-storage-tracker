"""Pytest configuration and fixtures."""

import pytest
import polars as pl
from datetime import datetime, timedelta
from pathlib import Path
import tempfile
import os

from app.database.duckdb_client import DuckDBClient
from app.services.cache_service import CacheService


@pytest.fixture
def test_data_dir():
    """Create temporary directory for test data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def mock_snapshot_data():
    """Generate mock snapshot data."""
    num_files = 100
    top_dirs = ["cil", "battuta_shares", "gcp", "home_dirs"]
    file_types = ["txt", "pdf", "py", "csv", "json", "log", "bin"]

    data = []
    for i in range(num_files):
        top_dir = top_dirs[i % len(top_dirs)]
        depth = (i % 4) + 1
        file_type = file_types[i % len(file_types)]

        path_parts = [top_dir] + [f"dir{j}" for j in range(depth)] + [f"file{i}.{file_type}"]
        path = "/" + "/".join(path_parts)

        data.append({
            "snapshot_date": "2024-01-15",
            "path": path,
            "size": 1024 * (i + 1),
            "modified_time": datetime.now() - timedelta(days=i),
            "accessed_time": datetime.now() - timedelta(days=i // 2),
            "created_time": datetime.now() - timedelta(days=i + 100),
            "file_type": file_type,
            "inode": 1000000 + i,
            "permissions": 420,
            "parent_path": "/" + "/".join(path_parts[:-1]),
            "depth": depth + 1,
            "top_level_dir": top_dir,
        })

    return pl.DataFrame(data)


@pytest.fixture
def mock_parquet_file(test_data_dir, mock_snapshot_data):
    """Create mock parquet file with test data."""
    snapshot_dir = test_data_dir / "snapshots" / "2024-01-15"
    snapshot_dir.mkdir(parents=True, exist_ok=True)

    parquet_path = snapshot_dir / "test_snapshot.parquet"
    mock_snapshot_data.write_parquet(parquet_path)

    return parquet_path


@pytest.fixture
def db_client(test_data_dir, mock_parquet_file):
    """Create DuckDB client with test data."""
    db_path = str(test_data_dir / "test.duckdb")
    snapshots_path = str(test_data_dir / "snapshots")

    client = DuckDBClient(db_path=db_path, snapshots_path=snapshots_path)
    yield client
    client.close()


@pytest.fixture
async def cache_service():
    """Create cache service (in-memory for testing)."""
    # For testing, we can use a mock cache that doesn't require Redis
    service = CacheService()
    service.enabled = False  # Disable Redis for tests
    yield service
    if service.client:
        await service.close()


@pytest.fixture
def sample_file_entry():
    """Sample FileEntry for testing."""
    return {
        "path": "/project/cil/data/file.txt",
        "size": 1048576,
        "modified_time": datetime(2024, 1, 15, 10, 30, 0),
        "accessed_time": datetime(2024, 1, 15, 10, 30, 0),
        "created_time": datetime(2024, 1, 1, 0, 0, 0),
        "file_type": "txt",
        "inode": 12345678,
        "permissions": 420,
        "parent_path": "/project/cil/data",
        "depth": 3,
        "top_level_dir": "cil",
        "snapshot_date": "2024-01-15"
    }


@pytest.fixture
def sample_snapshot():
    """Sample Snapshot for testing."""
    return {
        "date": "2024-01-15",
        "file_count": 1250000,
        "total_size": 429496729600,
        "top_level_dirs": ["cil", "battuta_shares", "gcp", "home_dirs"],
        "scan_duration": 3600.5,
        "created_at": "2024-01-15T23:45:00"
    }
