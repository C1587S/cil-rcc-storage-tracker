# Testing Guide

Complete testing suite for the CIL Storage Tracker. This suite validates the entire pipeline from filesystem scanning to frontend visualization.

## Overview

The test suite includes:

1. **Mock Data Generation** - Creates realistic filesystem structures
2. **Scanner Testing** - Tests incremental scanning and chunking
3. **Aggregation Testing** - Validates chunk consolidation
4. **Backend Import** - Verifies data import and storage
5. **End-to-End Validation** - Complete pipeline verification

## Quick Start

### Automated Integration Test

Run the complete test pipeline with one command:

```bash
cd rcc-workflows/testing
./run_integration_test.sh
```

This will:
- Generate mock filesystem data
- Scan all directories
- Aggregate chunk files
- Import to backend
- Verify the import

### Manual Testing

For step-by-step testing or troubleshooting:

```bash
# 1. Generate test data
python3 generate_test_data.py --scale small

# 2. Scan directories
cd ../../scanner
./target/release/storage-scanner scan \
    --path ../rcc-workflows/testing/test_data/project_cil/home_dirs \
    --output ../rcc-workflows/testing/scan_output/home_dirs.parquet \
    --incremental

# 3. Aggregate chunks
./target/release/storage-scanner aggregate \
    --input ../rcc-workflows/testing/scan_output \
    --output ../rcc-workflows/testing/aggregated/home_dirs.parquet \
    --delete-chunks

# 4. Import to backend
cd ../backend
source venv/bin/activate
python scripts/import_snapshot.py \
    ../rcc-workflows/testing/aggregated \
    2025-12-15-test
```

## Test Data Generator

### Usage

```bash
python3 generate_test_data.py [OPTIONS]
```

### Options

- `--output-dir PATH` - Output directory (default: ./test_data)
- `--scale SCALE` - Data scale: small, medium, or large

### Scales

**Small** (Default - Fast testing)
- 10 users with 20 files each
- 5 projects with 40 files each
- 3 shared directories
- Total: ~500 files, ~5 MB
- Generation time: <10 seconds

**Medium** (Moderate testing)
- 50 users with 40 files each
- 20 projects with 100 files each
- 10 shared directories
- Total: ~5,000 files, ~50 MB
- Generation time: ~30 seconds

**Large** (Stress testing)
- 100 users with 100 files each
- 50 projects with 200 files each
- 20 shared directories
- Total: ~20,000 files, ~200 MB
- Generation time: ~2 minutes

### Generated Structure

The generator creates a structure similar to /project/cil:

```
test_data/project_cil/
├── home_dirs/          # User home directories
│   ├── user001/
│   │   ├── documents/
│   │   ├── data/
│   │   ├── scripts/
│   │   └── results/
│   └── ...
├── gcp/                # Research project directories
│   ├── project_01_abc/
│   │   ├── raw_data/
│   │   ├── processed/
│   │   ├── analysis/
│   │   └── outputs/
│   └── ...
└── battuta_shares/     # Shared data directories
    ├── subdir_001/
    │   ├── nested/
    │   └── files...
    └── ...
```

## Integration Test Script

### Usage

```bash
./run_integration_test.sh [OPTIONS]
```

### Options

- `--scale SCALE` - Test data scale (small/medium/large)
- `--cleanup` - Remove all test files
- `--skip-generation` - Skip data generation (use existing data)

### Examples

```bash
# Run with small dataset (default)
./run_integration_test.sh

# Run with medium dataset
./run_integration_test.sh --scale medium

# Skip data generation (reuse existing)
./run_integration_test.sh --skip-generation

# Clean up all test files
./run_integration_test.sh --cleanup
```

### Test Steps

The script executes these steps:

1. **Check Prerequisites**
   - Verifies scanner binary exists
   - Checks Python and backend venv
   - Validates environment

2. **Generate Test Data**
   - Creates mock filesystem structure
   - Generates realistic file content
   - Reports statistics

3. **Run Scanner**
   - Scans each top-level directory
   - Uses incremental mode
   - Creates chunk files

4. **Aggregate Chunks**
   - Consolidates chunks per directory
   - Deletes intermediate files
   - Validates output

5. **Import to Backend**
   - Imports aggregated files
   - Validates schema
   - Verifies row counts

6. **Verify Import**
   - Checks file presence
   - Reads parquet files
   - Reports statistics

### Expected Output

```
======================================================================
Step 1: Generating Test Data (Scale: small)
======================================================================
...
Total directories: 45
Total files:       500
Total size:        5.23 MB

======================================================================
Step 2: Scanning Directories
======================================================================
INFO: Scanning: home_dirs
SUCCESS:   Scanned home_dirs: 3 chunks
...

======================================================================
Step 3: Aggregating Chunks
======================================================================
INFO: Aggregating home_dirs (3 chunks)...
SUCCESS:   Aggregated home_dirs: 245.5K
...

======================================================================
Step 4: Importing to Backend
======================================================================
Found 3 parquet file(s)
SUCCESS: Data imported to backend

======================================================================
Step 5: Verifying Import
======================================================================
INFO: Parquet files imported: 3
SUCCESS: Successfully read parquet file: 250 rows

======================================================================
Test Summary
======================================================================
Test Date:         2025-12-15-test
Scale:             small

Next steps:
  1. Start backend:
     cd backend && source venv/bin/activate && uvicorn app.main:app --reload

  2. Start frontend:
     cd frontend && npm run dev

  3. Open browser:
     http://localhost:3001/dashboard/2025-12-15-test
```

## Docker Testing

For testing with Docker:

```bash
# Start services for testing
cd docker
docker-compose -f docker-compose.testing.yml up --build

# In another terminal, run integration test
cd rcc-workflows/testing
./run_integration_test.sh

# Access services
# Backend: http://localhost:8000
# Frontend: http://localhost:3001

# Stop services
cd docker
docker-compose -f docker-compose.testing.yml down
```

## Testing Workflow Components

### Scanner Tests

Test scanner functionality:

```bash
# Basic scan
./target/release/storage-scanner scan \
    --path test_data/project_cil/gcp \
    --output scan.parquet

# Incremental scan with resume
./target/release/storage-scanner scan \
    --path test_data/project_cil \
    --output scan.parquet \
    --incremental \
    --rows-per-chunk 100 \
    --resume

# Verify output
ls -lh scan_chunk_*.parquet
cat scan_manifest.json
```

### Aggregation Tests

Test aggregation:

```bash
# Aggregate without deletion
./target/release/storage-scanner aggregate \
    --input scan_output/ \
    --output aggregated.parquet

# Aggregate with deletion
./target/release/storage-scanner aggregate \
    --input scan_output/ \
    --output aggregated.parquet \
    --delete-chunks

# Verify output
du -h aggregated.parquet
python3 -c "import polars as pl; print(pl.read_parquet('aggregated.parquet').shape)"
```

### Backend Import Tests

Test backend import:

```bash
cd backend
source venv/bin/activate

# Import test snapshot
python scripts/import_snapshot.py \
    ../rcc-workflows/testing/aggregated \
    2025-12-15-test

# Verify in database
ls -lh data/snapshots/2025-12-15-test/

# Test API
uvicorn app.main:app --reload

# In another terminal
curl http://localhost:8000/api/snapshots
curl http://localhost:8000/api/snapshots/2025-12-15-test
```

## Troubleshooting

### Scanner Binary Not Found

```bash
# Build scanner
cd scanner
cargo build --release

# Verify
./target/release/storage-scanner --version
```

### Python Import Errors

```bash
# Recreate venv
cd backend
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Test Data Already Exists

```bash
# Clean and regenerate
./run_integration_test.sh --cleanup
./run_integration_test.sh
```

### Docker Issues

```bash
# Rebuild containers
docker-compose down
docker-compose up --build

# Check logs
docker-compose logs backend
docker-compose logs frontend
```

## Performance Benchmarks

Expected performance on typical development machine:

| Scale | Files | Generation | Scan | Aggregate | Import | Total |
|-------|-------|------------|------|-----------|--------|-------|
| Small | 500 | <10s | ~5s | ~1s | ~2s | ~20s |
| Medium | 5,000 | ~30s | ~15s | ~3s | ~5s | ~60s |
| Large | 20,000 | ~2m | ~45s | ~8s | ~15s | ~4m |

## Continuous Integration

For CI/CD integration:

```bash
# Run in non-interactive mode
./run_integration_test.sh --scale small

# Check exit code
if [ $? -eq 0 ]; then
    echo "Tests passed"
else
    echo "Tests failed"
    exit 1
fi
```

## Cleanup

Remove all test artifacts:

```bash
# Using test script
./run_integration_test.sh --cleanup

# Manual cleanup
rm -rf test_data scan_output aggregated
rm -rf ../../backend/data/snapshots/*-test
```

## Best Practices

1. **Start with small scale** - Fastest for development
2. **Use medium for validation** - Good balance of speed and coverage
3. **Use large for stress testing** - Before production deployment
4. **Run cleanup regularly** - Prevent disk space issues
5. **Test on fresh backend** - Remove old test snapshots first

## Related Documentation

- [RCC Workflows Guide](../README.md)
- [Scanner Documentation](../../scanner/README.md)
- [Backend Documentation](../../backend/README.md)
- [Frontend Documentation](../../frontend/README.md)

---

Last Updated: 2025-12-12
