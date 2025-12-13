# CIL-RCC Storage Tracker

A full-stack storage analytics platform for analyzing filesystem snapshots from the UChicago RCC cluster. This tool provides interactive analytics and visualization for large-scale filesystem scans, enabling exploration of storage usage patterns across millions of files.

## Overview

This project consists of three main components that work together to scan, analyze, and visualize filesystem data:

1. **Scanner** - High-performance Rust-based filesystem scanner that generates Parquet files
2. **Backend** - FastAPI server with DuckDB for querying snapshot data
3. **Frontend** - Next.js web application for interactive data exploration

## Features

- Interactive dashboard with tree navigation for browsing filesystem hierarchy
- Heavy files analysis and file type distribution breakdowns
- Directory statistics and storage usage patterns
- High-performance queries on Parquet files without loading into memory
- Environment auto-detection for cluster and local Mac setups
- Snapshot management for comparing multiple time points

## Quick Start

### Prerequisites

- Python 3.10+ (for backend)
- Node.js 18+ (for frontend)
- Rust 1.81+ (for scanner, if building from source)
- Access to UChicago RCC cluster (for generating scans)

### Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The backend API will be available at http://localhost:8000

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at http://localhost:3001

### Docker Setup (Recommended)

For a reproducible development environment with both services:

```bash
cd docker
docker-compose up --build
```

This starts both backend and frontend with proper networking and health checks. See the [Docker documentation](docker/README.md) for testing and deployment configurations.

## Complete Pipeline

### RCC Cluster Workflow

For complete instructions on scanning on the UChicago RCC cluster, see the **[RCC Workflows Guide](rcc-workflows/README.md)**.

The workflow includes:
- Parallel scanning of multiple directories using Slurm job arrays
- Automatic aggregation of chunk files
- Data transfer and backend import instructions
- Troubleshooting and best practices

Quick start:
```bash
# On RCC cluster
cd /project/cil/home_dirs/username/projects/cil-rcc-storage-tracker
mkdir -p rcc-workflows/scripts/slurm_logs

# Submit scan jobs
sbatch rcc-workflows/scripts/01_scan_cil.sh

# After scans complete, aggregate chunks
sbatch rcc-workflows/scripts/02_aggregate_chunks.sh
```

### Manual Scan (Single Directory)

For testing or scanning individual directories:

```bash
# On the RCC cluster
cd scanner
cargo build --release

# Run a scan
./target/release/storage-scanner scan \
    --path /project/cil/gcp \
    --output /scratch/midway3/$USER/scan_output.parquet \
    --incremental \
    --resume \
    --threads 16
```

### 2. Aggregate and Import Data

After scanning, aggregate the Parquet chunks and import them to the backend:

```bash
# Copy scan results from cluster to local machine
scp -r username@midway3.rcc.uchicago.edu:/scratch/midway3/username/scans/2025-12-15 ./

# Aggregate chunks using scanner (recommended)
cd scanner
./target/release/storage-scanner aggregate \
    --input ../2025-12-15 \
    --output ../2025-12-15-aggregated/scan.parquet \
    --delete-chunks

# Import to backend data directory
cd ../backend
python scripts/import_snapshot.py ../2025-12-15-aggregated 2025-12-15
```

### 3. Analyze Data

Start the backend and frontend, then navigate to the dashboard:

```bash
# Terminal 1: Start backend
cd backend && source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2: Start frontend
cd frontend
npm run dev
```

Open your browser and navigate to the dashboard to explore the data.

## Project Structure

```
cil-rcc-storage-tracker/
├── docker/            # Docker configuration
│   ├── Dockerfile.backend         # Backend container
│   ├── Dockerfile.frontend        # Frontend container
│   ├── docker-compose.yml         # Development setup
│   ├── docker-compose.testing.yml # Testing configuration
│   └── README.md                  # Docker documentation
├── rcc-workflows/     # RCC cluster workflows and scripts
│   ├── scripts/      # Slurm job scripts (scan, aggregate)
│   ├── testing/      # Integration test suite
│   └── README.md     # Complete RCC workflow guide
├── scanner/           # Rust-based filesystem scanner
│   ├── src/          # Scanner source code
│   └── README.md     # Scanner documentation and usage
├── backend/           # FastAPI backend with DuckDB
│   ├── app/          # Application code (API routes, database, models)
│   ├── scripts/      # Data processing and import scripts
│   └── README.md     # Backend documentation and API reference
├── frontend/          # Next.js web application
│   ├── app/          # Next.js pages and layouts
│   ├── components/   # React components
│   ├── lib/          # API client and utilities
│   └── README.md     # Frontend documentation
└── README.md          # This file
```

## Technology Stack

### Scanner
- Rust (high-performance filesystem traversal)
- Apache Parquet (efficient columnar storage)
- Rayon (parallel processing)

### Backend
- FastAPI (REST API framework)
- DuckDB (analytical database for Parquet queries)
- PyArrow and Polars (data processing)
- Uvicorn (ASGI server)

### Frontend
- Next.js 14 with App Router
- React Query (TanStack Query for data fetching)
- Radix UI components
- Tailwind CSS

## Documentation

Each component has detailed documentation in its respective README:

- [Docker Documentation](docker/README.md) - Container setup, development and testing environments
- [RCC Workflows Guide](rcc-workflows/README.md) - Complete cluster scanning workflow
- [Testing Guide](rcc-workflows/testing/README.md) - Integration testing with mock data
- [Scanner Documentation](scanner/README.md) - Building, scanning, Slurm integration, resume capability
- [Backend Documentation](backend/README.md) - API endpoints, configuration, data processing scripts
- [Frontend Documentation](frontend/README.md) - Component structure, development workflow, deployment

## Common Tasks

### Run integration tests

Run the full end-to-end test suite (generates mock data, scans, imports, and verifies):

```bash
# Run integration tests
cd rcc-workflows/testing
./run_integration_test.sh --scale medium

# Start Docker environment
cd ../../docker
docker-compose up --build

# Access the frontend at http://localhost:3001
# Test snapshots will be available in the snapshot selector
```

Note: Integration tests create 2 snapshots for testing snapshot switching functionality.

### Create a test snapshot

```bash
cd backend
python scripts/create_test_snapshot.py
```

### Optimize snapshot performance

Note: Optimization now runs automatically during import. Manual optimization is only needed for existing snapshots.

```bash
cd backend
python scripts/optimize_snapshot.py 2025-12-15
```

### Check environment configuration

```bash
cd backend
python scripts/check_environment.py
```

## Current Status

- Local development setup: Working
- Scanner with incremental output and resume: Working
- Backend API with environment auto-detection: Working
- Frontend dashboard with analytics: Working
- Data import pipeline: Working
- Docker development and testing environments: Working
- Integration test suite: Working

## Todo List

### Critical (Performance Blockers) - COMPLETED December 2025
- [x] Pre-compute directory hierarchy during import
- [x] Create indexed lookup tables for immediate children queries
- [x] Materialize aggregated sizes at each directory level
- [x] Add indexes on path, size, and file_type columns
- [x] Generate multiple test snapshots for snapshot switching tests

Performance improvements: Optimized query performance through materialized tables and indexes.

### Outstanding
- [ ] Fix test data contamination (Redis cache isolation)

### High Priority (UX Improvements)
- [ ] Move root folder selector from header to left sidebar panel
- [ ] Make big folders always visible and clickable in sidebar
- [ ] Replace heavy files table with query builder panel
- [ ] Add SQL-like query interface with real examples
- [ ] Add clickable info button with query documentation and regex examples
- [ ] Add optional folder scope selection to manual filters
- [ ] Make filters independent from navigation state

### Medium Priority (Visualizations)
- [ ] Add fullscreen mode to disk usage tree
- [ ] Add percentage reference selector (current dir / parent / snapshot)
- [ ] Implement sunburst chart as alternative to tree view
- [ ] Add command-style toggle between tree and sunburst views

### Long-term (Deployment)
- [ ] Deploy backend API to cloud service
- [ ] Host DuckDB database on Hugging Face
- [ ] Deploy frontend to Vercel
- [ ] Automate snapshot updates with GitHub Actions
- [ ] Implement historical snapshot comparisons
- [ ] Add duplicate file detection
- [ ] Add growth trend analytics

---

Last Updated: 2025-12-12
