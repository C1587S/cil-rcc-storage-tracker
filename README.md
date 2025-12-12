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
- Rust 1.70+ (for scanner, if building from source)
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

## Complete Pipeline

### 1. Scan Filesystem on Cluster

Use the scanner to generate Parquet files from filesystem snapshots:

```bash
# On the RCC cluster
cd scanner
cargo build --release

# Run a scan
./target/release/storage-scanner scan \
    --path /project/cil \
    --output /scratch/midway3/$USER/scan_output.parquet \
    --incremental \
    --resume \
    --threads 16
```

For large scans with multiple directories, use the Slurm job array scripts provided in `scanner/scripts/`. See [scanner/README.md](scanner/README.md) for detailed instructions.

### 2. Aggregate and Import Data

After scanning, aggregate the Parquet chunks and import them to the backend:

```bash
# Copy scan results from cluster to local machine
scp -r username@midway3.rcc.uchicago.edu:/scratch/midway3/username/scans/2025-12-15 ./

# Aggregate chunks if using incremental mode
cd backend
python scripts/aggregate_scan_chunks.py ./2025-12-15 ./aggregated_2025-12-15

# Import to backend data directory
python scripts/import_snapshot.py ./aggregated_2025-12-15 2025-12-15
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
├── scanner/            # Rust-based filesystem scanner
│   ├── src/           # Scanner source code
│   ├── scripts/       # Slurm job scripts for cluster scanning
│   └── README.md      # Scanner documentation and usage
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

- [Scanner Documentation](scanner/README.md) - Building, scanning, Slurm integration, resume capability
- [Backend Documentation](backend/README.md) - API endpoints, configuration, data processing scripts
- [Frontend Documentation](frontend/README.md) - Component structure, development workflow, deployment

## Common Tasks

### Create a test snapshot

```bash
cd backend
python scripts/create_test_snapshot.py
```

### Optimize snapshot performance

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

Todo:
- [ ] Deploy backend API to cloud service
- [ ] Host DuckDB database on Hugging Face
- [ ] Deploy frontend to Vercel
- [ ] Automate snapshot updates with GitHub Actions
- [ ] Implement historical snapshot comparisons
- [ ] Add duplicate file detection
- [ ] Add growth trend analytics

---

Last Updated: 2025-12-12
