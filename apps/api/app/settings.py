"""Application settings and configuration."""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )

    # ClickHouse connection
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 9000
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_database: str = "filesystem"

    # Query limits and timeouts
    max_execution_time: int = 20  # seconds
    max_result_rows: int = 5000
    max_result_bytes: int = 50_000_000  # ~50MB

    # API settings
    api_title: str = "CIL-rcc-tracker API"
    api_version: str = "1.0.0"
    api_description: str = "Filesystem snapshot explorer backend"

    # CORS settings (comma-separated string)
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    def get_cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list from comma-separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
