# Storage Analytics System - Complete Guide

## Quick Start: From Scan to Dashboard in 6 Steps

### Prerequisites
- Rust (for scanner)
- Python 3.11+
- Node.js 20+

### Step 1: Build the Scanner
```bash
cd scanner
cargo build --release
cd ..
```

### Step 2: Scan a Directory
```bash
# Example: Scan your Documents folder
./scanner/target/release/storage-scanner scan \
    --path /Users/sebastiancadavidsanchez/Documents/Github/3cc \
    --output scan_testing/snapshot_$(date +%Y-%m-%d).parquet \
    --threads 8 \
    --batch-size 100000 \
    --verbose
```
project/cil/gcp
**Output**: Creates a `.parquet` file with all file metadata

### Step 3: Clean Old Database (If Needed)
```bash
# IMPORTANT: If you have previous test data, clean it first
rm -rf backend/data/storage_analytics.duckdb*
```

### Step 4: Import & Optimize Snapshot
```bash
cd backend

# Import the parquet file
python scripts/import_snapshot.py \
    ../scan_examples \
    $(date +%Y-%m-%d)

# CRITICAL: Optimize for large datasets
python scripts/optimize_snapshot.py $(date +%Y-%m-%d)
```

**What this does**:
- Copies parquet files to `backend/data/snapshots/YYYY-MM-DD/`
- Creates materialized summary tables for instant queries
- Pre-computes aggregations (0.2s for 1M+ files)

### Step 5: Start Backend
```bash
cd backend
uvicorn app.main:app --reload
```

**Verify it's working**:
```bash
curl http://localhost:8000/api/snapshots/
```

### Step 6: Start Frontend
```bash
cd frontend
npm install  # First time only
npm run dev
```

**Access dashboard**: http://localhost:3000

---

## Complete Workflow Script

Save as `scripts/scan_and_deploy.sh`:

```bash
#!/bin/bash
set -e

# Configuration
SCAN_PATH="${1:-/Users/sebastiancadavidsanchez/Documents/}"
SNAPSHOT_DATE=$(date +%Y-%m-%d)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJECT_ROOT"

echo "=========================================="
echo "Storage Analytics: Scan to Dashboard"
echo "=========================================="
echo ""
echo "Scan Path: $SCAN_PATH"
echo "Snapshot Date: $SNAPSHOT_DATE"
echo ""

# Step 1: Scan
echo "[1/6] Scanning directory..."
./scanner/target/release/storage-scanner scan \
    --path "$SCAN_PATH" \
    --output "scan_testing/snapshot_${SNAPSHOT_DATE}.parquet" \
    --threads 8 \
    --batch-size 100000 \
    --verbose

echo ""
echo "[2/6] Import snapshot..."
cd backend
python scripts/import_snapshot.py \
    ../scan_testing \
    "$SNAPSHOT_DATE"

echo ""
echo "[3/6] Optimize snapshot (create materialized tables)..."
python scripts/optimize_snapshot.py "$SNAPSHOT_DATE"

echo ""
echo "[4/6] Stop existing servers..."
cd "$PROJECT_ROOT"
pkill -f "uvicorn.*app.main:app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

echo ""
echo "[5/6] Start backend..."
cd backend
uvicorn app.main:app --reload > /tmp/backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "  ✓ Backend ready (PID: $BACKEND_PID)"
        break
    fi
    sleep 1
done

echo ""
echo "[6/6] Start frontend..."
cd "$PROJECT_ROOT/frontend"
npm run dev > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!

echo ""
echo "=========================================="
echo "Services Started!"
echo "=========================================="
echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:3000"
echo ""
echo "Logs:"
echo "  Backend:  tail -f /tmp/backend.log"
echo "  Frontend: tail -f /tmp/frontend.log"
echo ""
echo "To stop:"
echo "  pkill -f 'uvicorn.*app.main:app'"
echo "  pkill -f 'next dev'"
echo ""
```

**Usage**:
```bash
chmod +x scripts/scan_and_deploy.sh
./scripts/scan_and_deploy.sh /path/to/scan
```

---

## Performance Optimization

### For Large Datasets (1M+ files)

The **key step** is running `optimize_snapshot.py` after import. This creates materialized summary tables that make queries instant.

**Without optimization**:
- API Response: TIMEOUT (>30s)
- Frontend: ChunkLoadError

**With optimization**:
- API Response: 0.3s ✅
- Frontend: Instant ✅

### What Gets Pre-Computed

1. **snapshot_summary** - Total stats
2. **directory_breakdown** - Per-directory aggregations
3. **filetype_breakdown** - File type statistics
4. **heavy_files** - Top 1000 largest files

### Benchmark (1,010,490 files, 52GB)
- Materialization time: 0.24s
- Query time after: 0.278s
- **100x faster** than full table scan

---

## Troubleshooting

### Frontend Shows Old Data

**Problem**: Browser caching previous snapshot

**Solution**:
```bash
# Stop servers
pkill -f "next dev"
pkill -f "uvicorn"

# Clear frontend cache
cd frontend
rm -rf .next node_modules/.cache

# Restart
cd ../backend
uvicorn app.main:app --reload &

cd ../frontend
npm run dev &
```

**Then**: Open http://localhost:3000 in **incognito mode**

### API Timeout

**Problem**: Snapshot not optimized

**Solution**:
```bash
cd backend
python scripts/optimize_snapshot.py 2025-12-11
```

### DuckDB Corrupted/Lock Error

**Problem**: `Serialization Error: Failed to deserialize` or database locked

**Solution**:
```bash
# Stop all services
pkill -f "uvicorn"
pkill -f "next dev"
sleep 2

# Delete corrupted database
rm -rf backend/data/storage_analytics.duckdb*

# Re-import and optimize
cd backend
python scripts/import_snapshot.py ../scan_testing $(date +%Y-%m-%d)
python scripts/optimize_snapshot.py $(date +%Y-%m-%d)
```

---

## Scaling to Billions of Files

### Current Performance
- 1M files: 0.3s ✅
- 10M files: ~1-2s (estimated)
- 100M files: ~5-10s (estimated)

### For Billions
1. Partition by date/directory
2. Add DuckDB indexes
3. Use distributed Parquet storage (S3/MinIO)
4. Implement incremental scanning

---

## Directory Structure

```
storage-analytics/
├── scanner/                   # Rust scanner
│   └── target/release/
│       └── storage-scanner   # Compiled binary
├── backend/                   # Python API
│   ├── app/                  # FastAPI application
│   ├── data/                 # Storage
│   │   ├── snapshots/        # Parquet files
│   │   │   └── YYYY-MM-DD/
│   │   └── storage_analytics.duckdb  # Database
│   └── scripts/
│       ├── import_snapshot.py
│       └── optimize_snapshot.py  # CRITICAL for performance
├── frontend/                  # Next.js dashboard
│   └── app/                  # React components
├── scan_testing/             # Temporary scan output
└── scripts/
    ├── scan_and_deploy.sh    # Complete workflow
    ├── reset_cache.sh        # Clean everything
    └── restart_dev.sh        # Restart servers
```

---

## Development Workflow

### Daily Use
```bash
# Start development servers
cd backend && uvicorn app.main:app --reload &
cd frontend && npm run dev &
```

### New Snapshot
```bash
# Run scan
./scanner/target/release/storage-scanner scan \
    --path /new/path \
    --output scan_testing/snapshot_$(date +%Y-%m-%d).parquet

# Import + optimize
cd backend
python scripts/import_snapshot.py ../scan_testing $(date +%Y-%m-%d)
python scripts/optimize_snapshot.py $(date +%Y-%m-%d)

# Refresh browser (Cmd+Shift+R / Ctrl+Shift+R)
```

### Clean Start
```bash
./scripts/reset_cache.sh
./scripts/scan_and_deploy.sh /path/to/scan
```

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/scripts/import_snapshot.py` | Copy parquet to data/snapshots |
| `backend/scripts/optimize_snapshot.py` | Create materialized tables ⚡ |
| `backend/app/database/duckdb_client.py` | Query interface |
| `frontend/lib/hooks/useSnapshots.ts` | React data fetching |
| `scripts/scan_and_deploy.sh` | Complete automation |

---

## Production Deployment

### Slurm Job for Monthly Scans

```bash
#!/bin/bash
#SBATCH --job-name=storage-scan
#SBATCH --array=0-7
#SBATCH --cpus-per-task=16
#SBATCH --mem=8G
#SBATCH --time=8:00:00

DIRS=(cil battuta-shares-S3-archive battuta_shares gcp home_dirs kupe_shares norgay sacagawea_shares)
SNAPSHOT_DATE=$(date +%Y-%m-%d)

# Scan
./scanner/target/release/storage-scanner scan \
    --path /project/${DIRS[$SLURM_ARRAY_TASK_ID]} \
    --output /snapshots/${SNAPSHOT_DATE}/${DIRS[$SLURM_ARRAY_TASK_ID]}.parquet \
    --threads $SLURM_CPUS_PER_TASK

# Import & optimize
python backend/scripts/import_snapshot.py /snapshots/${SNAPSHOT_DATE} ${SNAPSHOT_DATE}
python backend/scripts/optimize_snapshot.py ${SNAPSHOT_DATE}
```

### Docker Compose

```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/data:/app/data
    environment:
      - DUCKDB_PATH=/app/data/storage_analytics.duckdb

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
```

---

## Support

For issues or questions:
1. Check logs: `/tmp/backend.log` and `/tmp/frontend.log`
2. Verify API: `curl http://localhost:8000/api/snapshots/`
3. Clear caches: `./scripts/reset_cache.sh`

---

## License

[Your License Here]
