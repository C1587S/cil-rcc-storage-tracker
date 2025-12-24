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
│   │   ├── query.py         # Query endpoints
│   │   └── voronoi.py       # Voronoi artifact endpoints (Task 3)
│   └── services/
│       ├── guardrails.py    # SQL validation
│       ├── voronoi_computer.py   # Voronoi computation (Task 3)
│       └── snapshot_storage.py   # Artifact storage (Task 3)
├── compute_voronoi.py       # CLI tool for artifact generation (Task 3)
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

## Voronoi Precomputation (Task 3)

### Overview

The backend now includes voronoi artifact precomputation to improve frontend performance. Instead of computing hierarchical voronoi treemaps on-the-fly in the browser, the backend generates and caches complete voronoi data structures as JSON artifacts.

**Benefits:**
- Eliminates real-time computation overhead
- Enables CDN distribution (Hugging Face integration planned)
- Consistent data across sessions
- Supports offline development

### Architecture

```
┌─────────────────┐
│  CLI Command    │  compute_voronoi.py
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ VoronoiComputer │  Fetches from ClickHouse
└────────┬────────┘  Builds hierarchy (depth 2)
         │
         ▼
┌─────────────────┐
│ SnapshotStorage │  Saves to /snapshots/{date}/
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Endpoint   │  /api/voronoi/artifact/{date}
└─────────────────┘
```

### Artifact Format

Each snapshot produces two files in `/snapshots/{snapshot_date}/`:

**1. voronoi.json** - Complete precomputed hierarchy
```json
{
  "version": "1.0.0",
  "snapshot": {
    "date": "2025-12-12",
    "path": "/project/cil",
    "size": 496145027233074,
    "file_count": 9
  },
  "computed_at": "2025-12-24T01:06:43.573664Z",
  "hierarchy": {
    "root_node_id": "dir_7854_54",
    "nodes": {
      "dir_7854_54": {
        "id": "dir_7854_54",
        "name": "cil",
        "path": "/project/cil",
        "size": 496145027233074,
        "isDirectory": true,
        "depth": 0,
        "children": ["dir_123_1", "dir_456_2", ...]
      }
    },
    "metadata": {
      "total_nodes": 54,
      "max_depth": 2,
      "top_level_count": 7
    }
  }
}
```

**2. metadata.json** - Quick summary
```json
{
  "snapshot_date": "2025-12-12",
  "root_path": "/project/cil",
  "computed_at": "2025-12-24T01:06:43.573664Z",
  "version": "1.0.0",
  "total_nodes": 54,
  "total_size": 496145027233074,
  "total_files": 9
}
```

### CLI Usage

```bash
# Activate virtual environment
cd apps/api
source venv/bin/activate

# Compute for specific snapshot
python compute_voronoi.py 2025-12-12

# Compute with custom path
python compute_voronoi.py 2025-12-12 --path /project/cil

# Compute for all available snapshots
python compute_voronoi.py --all

# Force recomputation (overwrites existing)
python compute_voronoi.py 2025-12-12 --force

# Increase preview depth (default: 2)
python compute_voronoi.py 2025-12-12 --depth 3

# Enable verbose logging
python compute_voronoi.py 2025-12-12 --verbose
```

**Performance:** Typical computation takes 3-5 seconds for depth-2 hierarchy with ~50 nodes.

### API Endpoints

#### Get Voronoi Artifact
```bash
GET /api/voronoi/artifact/{snapshot_date}

# Example
curl http://localhost:8000/api/voronoi/artifact/2025-12-12

# Response: Complete voronoi.json artifact (see format above)
```

#### Get Artifact Statistics
```bash
GET /api/voronoi/artifact/{snapshot_date}/stats

# Example
curl http://localhost:8000/api/voronoi/artifact/2025-12-12/stats

# Response
{
  "path": "/path/to/snapshots/2025-12-12/voronoi.json",
  "exists": true,
  "size_bytes": 31633,
  "modified_time": 1766538403.5746505,
  "version": "1.0.0",
  "computed_at": "2025-12-24T01:06:43.573664Z",
  "total_nodes": 54,
  "max_depth": 2,
  "top_level_count": 7
}
```

#### List All Artifacts
```bash
GET /api/voronoi/artifacts

# Example
curl http://localhost:8000/api/voronoi/artifacts

# Response
{
  "total": 1,
  "artifacts": [
    {
      "snapshot_date": "2025-12-12",
      "artifact_exists": true,
      "stats": { ... }
    }
  ]
}
```

### Data Schema

**VoronoiNodeData** structure:
- `id` (string): Unique node identifier
- `name` (string): Directory/file name
- `path` (string): Full filesystem path
- `size` (int): Size in bytes (recursive for directories)
- `isDirectory` (bool): Whether this is a directory
- `depth` (int): Hierarchy depth (0 = root)
- `children` (array[string] | null): Child node IDs
- `file_count` (int | null): Number of files in directory
- `isSynthetic` (bool): True for `__files__` nodes
- `originalFiles` (array | null): File list for synthetic nodes
- `color` (string | null): Reserved for frontend
- `polygon` (array | null): Reserved for frontend

### Error Handling

**Database unavailable:**
- CLI exits with error code 1
- API returns 500 with descriptive error
- No partial artifacts are saved

**Snapshot not found:**
- CLI logs warning and continues with next snapshot (if `--all`)
- API returns 404 with helpful message

**Artifact corruption:**
- Storage validates JSON schema before saving
- Atomic writes prevent partial files
- Invalid artifacts are rejected at save time

**Recomputation:**
- Use `--force` flag to overwrite existing artifacts
- Without `--force`, skips if artifact exists
- Safe to recompute - old artifact backed up as `.tmp` during write

### Scaling Considerations

**Current implementation (depth 2):**
- 50-100 nodes per snapshot
- 3-5 second computation time
- 30-50 KB artifact size
- Suitable for real-time generation

**Higher depths:**
- Depth 3: ~500 nodes, ~10 seconds, ~200 KB
- Depth 4: ~5000 nodes, ~60 seconds, ~2 MB
- Consider batch processing for depth >3

**Recommendations:**
- Keep default depth at 2 for interactive use
- Use batch/scheduled jobs for higher depths
- Monitor artifact sizes if enabling depth >3
- Consider compression for large artifacts

### Directory Structure

```
/home/scs/Git/dev-tracker-app/
├── snapshots/
│   ├── 2025-12-12/
│   │   ├── metadata.json
│   │   └── voronoi.json
│   └── 2025-12-19/
│       ├── metadata.json
│       └── voronoi.json
└── apps/api/
    ├── compute_voronoi.py
    └── app/
        ├── services/
        │   ├── voronoi_computer.py
        │   └── snapshot_storage.py
        └── routers/
            └── voronoi.py
```

### Integration with Frontend

The frontend will use a **priority cascade** loading strategy:

1. **Primary:** Hugging Face CDN (Task 4 - planned)
2. **Secondary:** Local backend via `/api/voronoi/artifact/{date}`
3. **Tertiary:** On-the-fly computation (existing fallback)

This ensures the frontend always works, even without precomputed artifacts.

### Known Limitations

- **Polygon data not included:** Frontend still computes voronoi polygons (requires d3-voronoi-treemap)
- **Depth limited to 2:** Higher depths require batch processing
- **Single root path:** Currently hardcoded to `/project/cil`
- **No incremental updates:** Must recompute entire hierarchy on changes

### Future Enhancements (Task 4+)

- Hugging Face upload integration for public CDN access
- Support for custom root paths via API parameter
- Incremental computation for updated snapshots
- Polygon precomputation using Python voronoi libraries
- Compression for large artifacts

## Deployment

See `Dockerfile` for containerized deployment options.

For production:
1. Use environment variables for configuration
2. Enable HTTPS (reverse proxy recommended)
3. Set appropriate `CORS_ORIGINS`
4. Consider rate limiting middleware
5. Monitor query performance and adjust limits as needed
6. Schedule voronoi artifact generation via cron/systemd timer
