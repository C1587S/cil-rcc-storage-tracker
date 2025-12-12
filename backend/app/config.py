"""Configuration management for the Storage Analytics Backend."""

from functools import lru_cache
from typing import Optional
from pathlib import Path
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # API Settings
    api_title: str = "Storage Analytics API"
    api_version: str = "1.0.0"
    api_description: str = "High-performance storage analytics and search API"
    debug: bool = False

    # Data Root Path (environment-specific)
    # On cluster: /project/cil
    # On local:   /Volumes/cil
    # Override with environment variable: DATA_ROOT_PATH
    data_root_path: Optional[str] = None

    # Database Settings
    duckdb_path: str = "data/storage_analytics.duckdb"
    snapshots_path: str = "data/snapshots"

    # Redis Settings
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_enabled: bool = True
    redis_ttl_default: int = 3600  # 1 hour
    redis_ttl_snapshots: int = 86400  # 24 hours
    redis_ttl_search: int = 3600  # 1 hour
    redis_ttl_folders: int = 7200  # 2 hours

    # Query Settings
    default_search_limit: int = 1000
    max_search_limit: int = 10000
    default_heavy_files_limit: int = 100
    max_heavy_files_limit: int = 1000

    # Performance Settings
    query_timeout: int = 30  # seconds
    max_workers: int = 4

    # CORS Settings
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

    # Logging
    log_level: str = "INFO"
    log_format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def get_data_root(self) -> Path:
        """
        Get the data root path with automatic environment detection.

        Resolution order:
        1. Explicit DATA_ROOT_PATH environment variable
        2. Auto-detect based on filesystem:
           - If /Volumes/cil exists → local Mac environment
           - If /project/cil exists → cluster environment
        3. Fallback to current directory

        Returns:
            Path object pointing to the data root
        """
        # 1. Check explicit environment variable
        if self.data_root_path:
            path = Path(self.data_root_path)
            if path.exists():
                return path
            else:
                raise ValueError(f"DATA_ROOT_PATH is set but doesn't exist: {self.data_root_path}")

        # 2. Auto-detect based on filesystem
        # Check for local Mac mount
        local_path = Path("/Volumes/cil")
        if local_path.exists():
            return local_path

        # Check for cluster path
        cluster_path = Path("/project/cil")
        if cluster_path.exists():
            return cluster_path

        # 3. Fallback to current directory (for development/testing)
        # This allows running with local data in the repo
        return Path.cwd()

    def get_absolute_snapshots_path(self) -> Path:
        """
        Get absolute path to snapshots directory.

        If snapshots_path is relative, it's relative to data_root.
        If snapshots_path is absolute, use it as-is.

        Returns:
            Absolute path to snapshots directory
        """
        snapshots = Path(self.snapshots_path)

        # If absolute path, use as-is
        if snapshots.is_absolute():
            return snapshots

        # If relative, resolve against data_root
        data_root = self.get_data_root()

        # Check if snapshots_path is relative to backend directory
        # (for local development with data in repo)
        backend_snapshots = Path(__file__).parent.parent / self.snapshots_path
        if backend_snapshots.exists():
            return backend_snapshots.resolve()

        # Otherwise, use data_root
        return (data_root / self.snapshots_path).resolve()

    def get_absolute_db_path(self) -> Path:
        """
        Get absolute path to DuckDB database file.

        Returns:
            Absolute path to database file
        """
        db_path = Path(self.duckdb_path)

        # If absolute path, use as-is
        if db_path.is_absolute():
            return db_path

        # Otherwise, relative to backend directory
        return (Path(__file__).parent.parent / self.duckdb_path).resolve()

    def get_environment_name(self) -> str:
        """
        Detect which environment we're running in.

        Returns:
            "cluster", "local", or "development"
        """
        if Path("/project/cil").exists():
            return "cluster"
        elif Path("/Volumes/cil").exists():
            return "local"
        else:
            return "development"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
