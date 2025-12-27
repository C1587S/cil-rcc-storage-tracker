# Web Application

Web interface for exploring filesystem snapshots stored in ClickHouse. Consists of a FastAPI backend and Next.js frontend.

## Components

### Backend API ([api/](api/))

FastAPI server that connects to ClickHouse and provides REST endpoints for the frontend.

**Key features:**
- REST API for filesystem queries
- ClickHouse connection management
- Snapshot listing and metadata
- Directory tree navigation
- File search and filtering
- Aggregation queries

See [api/README.md](api/README.md) for detailed documentation.

### Frontend ([web/](web/))

Next.js application with interactive visualizations for exploring filesystem data.

**Key features:**
- Directory tree browser
- Voronoi treemap visualization
- File search interface
- Size distribution charts
- Snapshot comparison
- Dark theme UI

See [web/README.md](web/README.md) for detailed documentation.

## Architecture

```
┌─────────────────────────────────────────┐
│         Browser (localhost:3000)        │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Next.js Frontend                 │ │
│  │  - React components               │ │
│  │  - TanStack Query (data fetching) │ │
│  │  - Zustand (state management)     │ │
│  │  - D3 (visualizations)            │ │
│  └──────────────┬────────────────────┘ │
└─────────────────┼───────────────────────┘
                  │ HTTP/JSON
                  ▼
         ┌─────────────────┐
         │  Next.js Proxy  │
         │  /api/* → :8000 │
         └────────┬─────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│    FastAPI Backend (localhost:8000)     │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  REST API                         │ │
│  │  - /api/snapshots                 │ │
│  │  - /api/tree                      │ │
│  │  - /api/voronoi                   │ │
│  │  - /api/search                    │ │
│  └──────────────┬────────────────────┘ │
└─────────────────┼───────────────────────┘
                  │ ClickHouse Protocol
                  ▼
         ┌─────────────────┐
         │   ClickHouse    │
         │   Database      │
         │   (port 9000)   │
         └─────────────────┘
```

## Quick Start

### Running Both Components

Terminal 1 - Start the backend:
```bash
cd apps/api
python -m venv venv
source venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Terminal 2 - Start the frontend:
```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000

### Prerequisites

- ClickHouse running with data imported (see [clickhouse/README.md](../clickhouse/README.md))
- Python 3.11+
- Node.js 18+

## API Endpoints

The backend provides these main endpoints:

### Snapshots
- `GET /api/snapshots` - List available snapshots
- `GET /api/snapshots/{date}` - Get snapshot metadata

### Navigation
- `GET /api/tree` - Get directory tree structure
- `POST /api/tree/expand` - Expand a directory node

### Visualization
- `GET /api/voronoi/{snapshot_date}` - Get voronoi treemap data
- `GET /api/voronoi/{snapshot_date}/node/{node_id}` - Get specific node

### Search
- `POST /api/search` - Search files by name, size, date, etc.
- `GET /api/search/filters` - Get available filter options

See [api/README.md](api/README.md) for complete API documentation.

## Data Flow

### Loading the Tree View

1. Frontend requests snapshot list from `/api/snapshots`
2. User selects a snapshot
3. Frontend fetches root tree from `/api/tree?snapshot_date=...&path=/`
4. User expands directories
5. Frontend requests child nodes via `/api/tree/expand`

### Loading the Voronoi Visualization

1. Frontend requests voronoi data from `/api/voronoi/{snapshot_date}`
2. Backend queries `voronoi_precomputed` table in ClickHouse
3. Frontend receives hierarchical data
4. D3 renders treemap visualization
5. User clicks on nodes to drill down
6. Frontend fetches child data from `/api/voronoi/{snapshot_date}/node/{node_id}`

### Search Flow

1. User enters search criteria in frontend
2. Frontend posts query to `/api/search`
3. Backend constructs ClickHouse SQL query
4. Results returned and displayed in table
5. User can sort, filter, and export results

## Configuration

### Backend (.env)

```bash
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=9000
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=filesystem
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The Next.js app proxies `/api/*` requests to the backend automatically (configured in `next.config.js`).

## Development

### Backend Development

```bash
cd apps/api
pip install -e ".[dev]"

# Run with auto-reload
uvicorn app.main:app --reload --port 8000

# Run tests
pytest

# Format code
black .
ruff check .
```

### Frontend Development

```bash
cd apps/web
npm install

# Dev server with hot reload
npm run dev

# Type checking
npm run type-check

# Build for production
npm run build
npm start
```

## Deployment

### Production Backend

```bash
cd apps/api
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Production Frontend

```bash
cd apps/web
npm run build
npm start
```

Or use a process manager like PM2:

```bash
pm2 start npm --name "tracker-web" -- start
```

### Docker Deployment (Future)

A Docker Compose setup for running all components together is planned.

## Performance Considerations

### Backend

- ClickHouse connection pooling is handled by the driver
- Query results are streamed for large responses
- No caching layer currently (queries hit ClickHouse directly)

### Frontend

- TanStack Query provides automatic caching and deduplication
- Tree data is loaded incrementally (only expanded nodes)
- Voronoi data can be large for root-level views (performance optimization planned)

See component READMEs for specific performance tuning options.

## Troubleshooting

### Backend won't start

Check ClickHouse connection:
```bash
docker ps | grep clickhouse
```

Verify `.env` settings match your ClickHouse setup.

### Frontend shows "API Error"

Ensure backend is running:
```bash
curl http://localhost:8000/health
```

Check browser console for specific error messages.

### Slow visualizations

For large directories, the voronoi treemap can be slow to render. This is a known issue being addressed. Try:
- Start from a deeper path instead of root
- Use the tree view for navigation
- Limit the depth parameter in queries

## Tech Stack

### Backend
- FastAPI (web framework)
- clickhouse-driver (database client)
- Pydantic (data validation)
- Uvicorn (ASGI server)

### Frontend
- Next.js 14 (React framework with App Router)
- TypeScript
- Tailwind CSS (styling)
- TanStack Query (data fetching)
- Zustand (state management)
- D3 (visualizations)
- shadcn/ui (UI components)

## Future Improvements

- Docker Compose for single-command deployment
- Response caching layer (Redis)
- WebSocket support for real-time updates
- Voronoi rendering performance optimization
- User authentication
- Saved queries and dashboards
- Export functionality for reports
