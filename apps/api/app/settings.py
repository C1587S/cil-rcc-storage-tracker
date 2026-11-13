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
    # True: the session sets readonly=1 (needed when the account itself is
    # not read-only, e.g. `default`). False: rely on the account's settings
    # profile (tracker_api, see scripts/setup-clickhouse-users.sh), which
    # rejects any attempt to set `readonly`. Forced True for `default`.
    clickhouse_session_readonly: bool = True
    # Account for /api/computing/ingest (INSERT on computing.* only).
    # Empty = fall back to the main account.
    clickhouse_ingest_user: str = ""
    clickhouse_ingest_password: str = ""

    # Query limits and timeouts
    max_execution_time: int = 20  # seconds
    max_result_rows: int = 8000
    max_result_bytes: int = 50_000_000  # ~50MB

    # API settings
    api_title: str = "CIL-rcc-tracker API"
    api_version: str = "1.0.0"
    api_description: str = "Filesystem snapshot explorer backend"

    # Interactive API docs (/docs, /redoc, /openapi.json). Off in deployment:
    # they map every endpoint for anyone who reaches the API. API_DOCS=true
    # to enable locally.
    api_docs: bool = False

    # CORS settings (comma-separated string)
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    # Snapshots directory for voronoi artifacts
    snapshots_dir: str = "/app/snapshots"

    # Groq API (natural language to SQL)
    groq_api_key: str = ""

    # Computing monitoring
    computing_report_url: str = "https://users.rcc.uchicago.edu/~cadavidsanchez/cil_scans/quotas/latest.json"

    # Projections monitoring (pi-mgreenst)
    projections_report_url: str = "https://users.rcc.uchicago.edu/~cadavidsanchez/cil_scans/projections/latest.json"

    # Additional allowed users (non-RCC members, comma-separated usernames)
    allowed_users: str = ""

    def get_allowed_users_list(self) -> list[str]:
        """Get additional allowed users as a list."""
        return [u.strip() for u in self.allowed_users.split(",") if u.strip()]

    def get_cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list from comma-separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
