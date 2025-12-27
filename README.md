# Filesystem Storage Tracker

System for tracking and analyzing large-scale filesystem storage usage. This tool scans filesystems, stores snapshots in ClickHouse, and provides a web interface for exploration and analysis.

## Components

This repository contains three main components:

1. **[scanner/](scanner/)** - Rust-based filesystem scanner that generates Parquet files
2. **[clickhouse/](clickhouse/)** - Database backend for storing and querying snapshots
3. **[apps/](apps/)** - Web application (backend API + frontend) for visualization

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Python 3.11 or later
- Rust 1.70 or later (for building scanner)
- Node.js 18+ (for web frontend)

### Complete Workflow

This guide walks through the entire process from scanning to visualization.

#### 1. Scan the Filesystem

Build and run the scanner to generate snapshot data:

```bash
cd scanner
cargo build --release

# Run a basic scan
./target/release/storage-scanner \
  --path /path/to/scan \
  --output scan_output.parquet
```

For parallel scanning on HPC systems with Slurm:

```bash
cd scanner/scripts
./scan_cil_parallel.sh
```

See [scanner/README.md](scanner/README.md) for detailed scanning options.

#### 2. Set Up ClickHouse

Start ClickHouse using Docker:

```bash
cd clickhouse
docker compose up -d
```

Initialize the database schema:

```bash
cd clickhouse
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python scripts/setup_database.py
```

See [clickhouse/README.md](clickhouse/README.md) for manual setup and configuration options.

#### 3. Import Snapshot Data

Import the Parquet file into ClickHouse:

```bash
cd clickhouse
python scripts/import_snapshot.py /path/to/scan_output.parquet 2025-12-12
```

The second argument is the snapshot date (YYYY-MM-DD format).

#### 4. Compute Voronoi Hierarchy

Generate precomputed visualization data:

```bash
cd clickhouse
python scripts/compute_voronoi_unified.py 2025-12-12
```

This creates an optimized tree structure for the web visualization.

#### 5. Run the Web Application

Start the backend API:

```bash
cd apps/api
python -m venv venv
source venv/bin/activate
pip install -e .

# Configure environment
cp .env.example .env

# Start server
uvicorn app.main:app --reload --port 8000
```

Start the frontend:

```bash
cd apps/web
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

See [apps/README.md](apps/README.md) for more details on running the web application.

## Environment Setup

For a complete Python environment with all dependencies:

```bash
# Create conda environment
conda env create -f environment.yml

# Activate
conda activate storage_scanner
```

The environment includes:
- Python 3.11
- Rust toolchain
- FastAPI and dependencies
- ClickHouse driver
- Data processing libraries (Polars, PyArrow)

For RCC-specific setup, edit `environment.yml` to uncomment the prefix path.

## Architecture

```
┌─────────────────┐
│  Filesystem     │
│  (400+ TB)      │
└────────┬────────┘
         │
         │ 1. Scan
         ▼
┌─────────────────┐
│  Scanner        │
│  (Rust)         │
└────────┬────────┘
         │
         │ 2. Generate Parquet
         ▼
┌─────────────────┐
│  Parquet Files  │
│  (Snapshots)    │
└────────┬────────┘
         │
         │ 3. Import
         ▼
┌─────────────────┐
│  ClickHouse     │
│  Database       │
└────────┬────────┘
         │
         │ 4. Query
         ▼
┌─────────────────┐
│  FastAPI        │
│  Backend        │
└────────┬────────┘
         │
         │ 5. HTTP API
         ▼
┌─────────────────┐
│  Next.js        │
│  Frontend       │
└─────────────────┘
```

## Usage Examples

### Finding Large Files

Use the web interface to:
1. Navigate the directory tree
2. Sort by size
3. Filter by file type or date
4. View size distributions

### Tracking Storage Growth

1. Import snapshots from different dates
2. Use the comparison view to see changes
3. Identify directories with the most growth

### Identifying Stale Data

1. Filter files by last modified date
2. Find large files not accessed recently
3. Generate reports for cleanup

## Documentation

- [scanner/README.md](scanner/README.md) - Scanner usage and performance
- [clickhouse/README.md](clickhouse/README.md) - Database setup and queries
- [clickhouse/scripts/README.md](clickhouse/scripts/README.md) - Import and processing scripts
- [apps/README.md](apps/README.md) - Web application architecture
- [apps/api/README.md](apps/api/README.md) - Backend API documentation
- [apps/web/README.md](apps/web/README.md) - Frontend documentation

## Performance

Typical performance on NVMe storage:

- **Scanning**: 50,000+ files/second
- **Import**: 100,000+ rows/second to ClickHouse
- **Queries**: Sub-second response for most aggregations
- **Web UI**: Fast navigation through billions of files

## Development

### Project Structure

```
.
├── scanner/           # Rust scanner
│   ├── src/          # Source code
│   ├── scripts/      # Scanning scripts
│   └── benches/      # Benchmarks
├── clickhouse/        # Database layer
│   ├── schema/       # SQL schema files
│   ├── scripts/      # Python import/processing scripts
│   └── docs/         # Query examples
└── apps/             # Web application
    ├── api/          # FastAPI backend
    └── web/          # Next.js frontend
```

### Running Tests

Scanner tests:
```bash
cd scanner
cargo test
```

API tests:
```bash
cd apps/api
pip install -e ".[dev]"
pytest
```

## Troubleshooting

### ClickHouse Connection Issues

Ensure ClickHouse is running:
```bash
docker ps | grep clickhouse
```

Check logs:
```bash
docker logs tracker-clickhouse
```

### Import Failures

Check Parquet file format:
```bash
python -c "import polars as pl; print(pl.read_parquet('file.parquet').schema)"
```

Verify database connection in `.env` file.

### Web Application Issues

Check API is running:
```bash
curl http://localhost:8000/health
```

Check browser console for errors.

See component READMEs for detailed troubleshooting.

## License

[Add license information]

## Contributing

[Add contributing guidelines]
