# ClickHouse Scripts

Data pipeline scripts for filesystem analytics.

## Scripts

### `voronoi_storage.py`

**Purpose:** Library for streaming voronoi nodes to ClickHouse.

**Usage:**
```python
from voronoi_storage import VoronoiStorage
from datetime import date

storage = VoronoiStorage(batch_size=1000)
storage.ensure_table_exists()

storage.add_node(
    snapshot_date=date(2025, 12, 12),
    node_id="dir_123",
    parent_id="dir_root",
    path="/project/cil/gcp",
    name="gcp",
    size=112442927866637,
    depth=1,
    is_directory=True,
    file_count=42,
    children_ids=["dir_456", "dir_789"],
    is_synthetic=False,
    original_files=[]
)

storage.flush()
```

### `compute_voronoi_unified.py`

**Purpose:** Compute complete voronoi hierarchy for filesystem snapshots.

**Usage:**

```bash
# Single snapshot
python compute_voronoi_unified.py 2025-12-12

# Force recomputation
python compute_voronoi_unified.py 2025-12-12 --force

# All snapshots
python compute_voronoi_unified.py --all

# Custom connection
python compute_voronoi_unified.py 2025-12-12 \
  --host localhost \
  --port 9000 \
  --user default \
  --database filesystem

# Custom root path
python compute_voronoi_unified.py 2025-12-12 --root /project/cil

# Help
python compute_voronoi_unified.py --help
```

**Options:**
- `--force` - Delete existing data and recompute
- `--all` - Process all available snapshots
- `--root PATH` - Root path to start from (default: /project/cil)
- `--host HOST` - ClickHouse host (default: localhost)
- `--port PORT` - ClickHouse port (default: 9000)
- `--user USER` - ClickHouse user (default: default)
- `--password PASSWORD` - ClickHouse password (default: empty)
- `--database DATABASE` - ClickHouse database (default: filesystem)
- `--batch-size N` - Batch size for inserts (default: 1000)
- `--verbose` - Enable verbose logging

**Expected output:**
```
============================================================
Starting voronoi computation for 2025-12-12
============================================================
Found 42,488,746 rows to process
Executing streaming query...
Building hierarchy: 100%|████████| 42488746/42488746 [00:44<00:00, 956234rows/s]
Finalizing remaining nodes in stack...
============================================================
Computation complete!
Total rows processed: 42,488,746
Total nodes inserted: 8,234,521
============================================================
```

### `setup_database.py`

**Purpose:** Initialize ClickHouse database schema.

**Usage:**
```bash
python setup_database.py
```

Creates:
- `filesystem` database
- `entries` table
- `snapshots` table
- `search_index` table
- Materialized views for aggregations
- Indexes for search

### `import_snapshot.py`

**Purpose:** Import filesystem snapshot data from Parquet files.

**Usage:**
```bash
python import_snapshot.py /path/to/snapshot.parquet 2025-12-12
```

## Complete Workflow

### 1. Initialize database
```bash
python setup_database.py
```

### 2. Import snapshot data
```bash
python import_snapshot.py /data/snapshots/2025-12-12.parquet 2025-12-12
```

### 3. Compute voronoi hierarchy
```bash
python compute_voronoi_unified.py 2025-12-12
```

### 4. Verify
```bash
docker exec tracker-clickhouse clickhouse-client \
  --query "SELECT count() FROM filesystem.voronoi_precomputed WHERE snapshot_date='2025-12-12'"
```

## Documentation

See `../README.md` for comprehensive documentation on:
- Architecture
- Table schemas
- Performance tuning
- Troubleshooting
- API integration
