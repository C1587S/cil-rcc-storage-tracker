# Docker Setup

Docker configuration for the CIL Storage Tracker. This directory contains all Docker-related files for development, testing, and deployment.

## Files

- `Dockerfile.backend` - Backend service (FastAPI + DuckDB)
- `Dockerfile.frontend` - Frontend service (Next.js)
- `docker-compose.yml` - Development and general use
- `docker-compose.testing.yml` - Integration testing configuration

## Quick Start

### Development

Start both backend and frontend services:

```bash
cd docker
docker-compose up --build
```

Services will be available at:
- Backend: http://localhost:8000
- Frontend: http://localhost:3001

### Testing

Run the integration test suite:

```bash
# From project root, generate test data and run tests
cd rcc-workflows/testing
./run_integration_test.sh

# In another terminal, start Docker services for testing
cd docker
docker-compose -f docker-compose.testing.yml up --build
```

### Production Build

For production deployment, update the frontend Dockerfile to use the production build:

1. Add `output: 'standalone'` to `frontend/next.config.js`
2. Uncomment the production build stages in `Dockerfile.frontend`
3. Update `docker-compose.yml` to use the `runner` target

## Usage

### Start Services

```bash
docker-compose up
```

### Start in Background

```bash
docker-compose up -d
```

### View Logs

```bash
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Stop Services

```bash
docker-compose down
```

### Rebuild Services

```bash
docker-compose up --build
```

### Clean Up

Remove all containers, networks, and volumes:

```bash
docker-compose down -v
```

## Configuration

### Environment Variables

Backend environment variables are defined in `docker-compose.yml`:

- `SNAPSHOTS_PATH` - Path to snapshot parquet files
- `DUCKDB_PATH` - Path to DuckDB database
- `LOG_LEVEL` - Logging level (INFO, DEBUG)
- `CORS_ORIGINS` - Allowed CORS origins

Frontend environment variables:

- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXT_PUBLIC_APP_NAME` - Application name

### Volumes

The development configuration mounts source directories for hot reloading:

Backend:
- `../backend/app:/app/app` - Application code
- `../backend/data:/app/data` - Data directory
- `../backend/scripts:/app/scripts` - Utility scripts

Frontend:
- `../frontend/app:/app/app` - Next.js app directory
- `../frontend/components:/app/components` - React components
- `../frontend/lib:/app/lib` - Utilities and libraries
- `../frontend/public:/app/public` - Static assets

### Networks

Services communicate over a dedicated Docker network:

- `storage-analytics` - Development network
- `storage-analytics-test` - Testing network

## Health Checks

The backend service includes a health check that verifies the API is responding:

- Interval: 10 seconds
- Timeout: 5 seconds
- Retries: 5

The frontend depends on the backend being healthy before starting.

## Troubleshooting

### Backend won't start

Check logs:
```bash
docker-compose logs backend
```

Common issues:
- Port 8000 already in use
- Missing data directories
- Database connection errors

### Frontend won't start

Check logs:
```bash
docker-compose logs frontend
```

Common issues:
- Backend not healthy
- Port 3000/3001 already in use
- Missing environment variables

### Build failures

Clean rebuild:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up
```

### Cannot access services

Verify containers are running:
```bash
docker-compose ps
```

Check network connectivity:
```bash
docker network inspect storage-analytics
```

## Development Tips

### Hot Reloading

Both services support hot reloading in development mode:

- Backend: uvicorn with `--reload`
- Frontend: Next.js dev server

Changes to source files will automatically restart the services.

### Database Access

Access the DuckDB database from the backend container:

```bash
docker-compose exec backend python
>>> import duckdb
>>> conn = duckdb.connect('data/storage_analytics.duckdb')
>>> conn.execute("SELECT * FROM snapshots").fetchall()
```

### Import Test Data

Import test snapshots while services are running:

```bash
docker-compose exec backend python scripts/import_snapshot.py \
  /app/test_data 2025-12-12-test
```

## Related Documentation

- [Testing Guide](../rcc-workflows/testing/README.md)
- [Backend Documentation](../backend/README.md)
- [Frontend Documentation](../frontend/README.md)
- [RCC Workflows](../rcc-workflows/README.md)
