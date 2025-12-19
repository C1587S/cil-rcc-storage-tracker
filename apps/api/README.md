# CIL-rcc-tracker API

FastAPI backend for the CIL-rcc-tracker filesystem explorer.

## Quick Start

### Prerequisites

- Python 3.11+
- ClickHouse server running (see `../../clickhouse/README.md`)
- ClickHouse database populated with snapshot data

### Installation

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -e .

# Or for development
pip install -e ".[dev]"
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` to match your ClickHouse setup (defaults should work for local Docker setup).

### Running the Server

```bash
# Development mode with auto-reload
uvicorn app.main:app --reload --port 8000

# Production mode
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

The API will be available at:
- API: http://localhost:8000
- Interactive docs: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## API Endpoints

### Snapshots

- `GET /api/snapshots` - List all available snapshots
- `GET /api/snapshots/{snapshot_date}` - Get metadata for a specific snapshot

### Browse

- `GET /api/browse` - Get child folders for a directory (folders only)
  - Query params: `snapshot_date`, `parent_path`, `limit`
  - **Note**: Returns direct children sizes only, not recursive totals. Directory sizes shown are the sum of immediate child files. For recursive totals, use the query endpoint with path prefix matching.

### Contents

- `GET /api/contents` - Get directory contents (folders + files)
  - Query params: `snapshot_date`, `parent_path`, `limit`, `offset`, `sort`, `filter_type`

### Search

- `GET /api/search` - Search for files/directories by name
  - Query params: `snapshot_date`, `q`, `mode`, `scope_path`, `include_files`, `include_dirs`, `limit`
  - Modes: `exact`, `contains`, `prefix`, `suffix`

### Query

- `POST /api/query` - Execute SQL query with guardrails
  - Body: `{snapshot_date, sql, limit}`

## Security Features

### SQL Guardrails

All user SQL queries are validated with strict guardrails:

- Only SELECT queries allowed
- Single statement only (no semicolons)
- Read-only mode enforced at connection level
- Must include snapshot_date filter
- Auto-append LIMIT if missing
- No DDL/DML keywords (INSERT, DELETE, DROP, etc.)
- No external table functions (url, remote, s3, etc.)
- No output redirection (INTO OUTFILE, FORMAT overrides)

### Connection Limits

Server-side limits enforced via ClickHouse settings:

- max_execution_time: 20 seconds
- max_result_rows: 5,000 rows
- max_result_bytes: 50 MB
- readonly: 1 (read-only mode)

## Development

### Code Style

```bash
# Format code
black .

# Lint
ruff check .
```

### Testing

```bash
# Run tests (when implemented)
pytest
```

## Architecture

```
apps/api/
├── app/
│   ├── main.py              # FastAPI application
│   ├── settings.py          # Configuration
│   ├── db/
│   │   └── clickhouse.py    # Database connection
│   ├── models/
│   │   └── __init__.py      # Pydantic models
│   ├── routers/
│   │   ├── snapshots.py     # Snapshot endpoints
│   │   ├── browse.py        # Browse endpoints
│   │   ├── contents.py      # Contents endpoints
│   │   ├── search.py        # Search endpoints
│   │   └── query.py         # Query endpoints
│   └── services/
│       └── guardrails.py    # SQL validation
├── pyproject.toml
└── README.md
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLICKHOUSE_HOST` | localhost | ClickHouse server host |
| `CLICKHOUSE_PORT` | 9000 | ClickHouse native protocol port |
| `CLICKHOUSE_USER` | default | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | (empty) | ClickHouse password |
| `CLICKHOUSE_DATABASE` | filesystem | Database name |
| `MAX_EXECUTION_TIME` | 20 | Max query execution time (seconds) |
| `MAX_RESULT_ROWS` | 5000 | Max rows returned per query |
| `MAX_RESULT_BYTES` | 50000000 | Max bytes returned per query |
| `CORS_ORIGINS` | http://localhost:3000 | Allowed CORS origins |

## Deployment

See `Dockerfile` for containerized deployment options.

For production:
1. Use environment variables for configuration
2. Enable HTTPS (reverse proxy recommended)
3. Set appropriate `CORS_ORIGINS`
4. Consider rate limiting middleware
5. Monitor query performance and adjust limits as needed
