"""Configuration management for the Storage Analytics Backend."""

from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # API Settings
    api_title: str = "Storage Analytics API"
    api_version: str = "1.0.0"
    api_description: str = "High-performance storage analytics and search API"
    debug: bool = False

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


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
