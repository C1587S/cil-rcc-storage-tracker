# Integration Scripts

Scripts for integrating scanner output with the backend for local development.

## Overview

These scripts help you work with parquet files produced on the server and make them available to the local backend/frontend.

## Scripts

### 1. `validate_parquet.py` - Validate Parquet Files

Validates parquet snapshot files to ensure data integrity.

**Usage:**
```bash
python validate_parquet.py <snapshot_directory>
```

**Example:**
```bash
# Validate files in a directory
python validate_parquet.py /tmp/scan_output

# Validate files from server
python validate_parquet.py ~/Downloads/snapshot_2024_01_15
```

**What it checks:**
- Files exist and are readable
- Required columns are present (`path`, `size`, `modified_time`, `file_type`, etc.)
- Column data types are correct
- No null/invalid data
- Reasonable row counts

**Output:**
```
Found 3 parquet file(s) to validate

Validating: cil.parquet
  Rows: 125,432
  Columns: 10
  ✓ Schema validation passed

============================================================
VALIDATION SUMMARY
============================================================
✓ Status: PASSED

Files validated: 3
Total rows: 342,156

✓ All validations passed successfully
============================================================
```

---

### 2. `import_snapshot.py` - Import to Backend

Imports parquet files into the backend data directory so they can be queried via the API.

**Usage:**
```bash
# Import snapshot
python ../../backend/scripts/import_snapshot.py <source_dir> <snapshot_date>

# List existing snapshots
python ../../backend/scripts/import_snapshot.py --list
```

**Examples:**
```bash
# Import parquet files from server
python ../../backend/scripts/import_snapshot.py ~/Downloads/snapshot_2024_01_15 2024-01-15

# Import from temporary scan location
python ../../backend/scripts/import_snapshot.py /tmp/scan_output 2024-12-10

# List all imported snapshots
python ../../backend/scripts/import_snapshot.py --list
```

**What it does:**
1. Validates source parquet files
2. Checks snapshot date format (YYYY-MM-DD)
3. Creates destination directory in `backend/data/snapshots/<date>/`
4. Copies parquet files
5. Verifies files are readable by DuckDB

**Output:**
```
============================================================
PARQUET SNAPSHOT IMPORT
============================================================
Source: /Users/you/Downloads/snapshot_2024_01_15
Destination: /path/to/backend/data/snapshots/2024-01-15
Snapshot Date: 2024-01-15

Found 3 parquet file(s)

Validating parquet files...
  ✓ cil.parquet: 125,432 rows
  ✓ battuta_shares.parquet: 98,234 rows
  ✓ gcp.parquet: 45,123 rows

Creating destination directory...

Copying files...
  Copying: cil.parquet
  Copying: battuta_shares.parquet
  Copying: gcp.parquet

Verifying copied files...
  ✓ cil.parquet: 125,432 rows
  ✓ battuta_shares.parquet: 98,234 rows
  ✓ gcp.parquet: 45,123 rows

============================================================
IMPORT SUCCESSFUL
============================================================
Snapshot Date: 2024-01-15
Files Imported: 3
Total Rows: 268,789
Location: /path/to/backend/data/snapshots/2024-01-15

The snapshot is now available to the backend API.
============================================================
```

---

### 3. `full_pipeline.sh` - Complete Pipeline

Automates the entire workflow: scan → validate → import → verify.

**Usage:**
```bash
# Scan a directory and import
./full_pipeline.sh <directory_to_scan> <snapshot_date>

# Import existing parquet files (skip scanning)
./full_pipeline.sh --import <parquet_directory> <snapshot_date>
```

**Examples:**
```bash
# Scan test fixtures and import
./full_pipeline.sh ../../scanner/tests/fixtures/test_project 2024-01-01

# Import parquet files from server
./full_pipeline.sh --import ~/Downloads/server_scan_2024_01_15 2024-01-15

# Scan with custom thread count
SCANNER_THREADS=32 ./full_pipeline.sh /data/to/scan 2024-12-10

# Skip validation (faster import)
./full_pipeline.sh --no-validate --import ~/Downloads/scan 2024-01-15
```

**Options:**
- `--import` - Import existing parquet files (skip scanning)
- `--skip-scan` - Skip scanning step
- `--no-validate` - Skip validation step
- `-h, --help` - Show help message

**Environment Variables:**
- `SCANNER_THREADS` - Number of threads for scanner (default: auto-detect)
- `TEMP_SCAN_DIR` - Temporary directory for scans (default: `/tmp/storage_analytics_scan`)

**What it does:**
1. Checks all dependencies
2. Scans directory (or uses existing parquet files)
3. Validates parquet output
4. Imports to backend
5. Verifies backend can access the data

**Output:**
```
============================================================
Storage Analytics Pipeline
============================================================

[INFO] Source: ~/Downloads/snapshot_2024_01_15
[INFO] Snapshot Date: 2024-01-15
[INFO] Mode: Import

[INFO] Checking dependencies...
[SUCCESS] All dependencies found

============================================================
Step 1: Scanning Directory
============================================================
(skipped in import mode)

============================================================
Step 2: Validating Parquet Files
============================================================
... validation output ...
[SUCCESS] Validation passed

============================================================
Step 3: Importing to Backend
============================================================
... import output ...
[SUCCESS] Import completed successfully

============================================================
Step 4: Verifying Backend Access
============================================================
... list of snapshots ...
[SUCCESS] Backend verification complete

------------------------------------------------------------
[SUCCESS] Pipeline completed successfully!

Next steps:
  1. Start the backend: cd backend && uvicorn app.main:app --reload
  2. Start the frontend: cd frontend && npm run dev
  3. Open http://localhost:3000 and select snapshot: 2024-01-15

------------------------------------------------------------
```

---

## Typical Workflow

### Scenario 1: Import Parquet Files from Server

You've scanned storage on the server and downloaded the parquet files locally.

```bash
# 1. Download parquet files from server
scp server:/path/to/snapshots/2024-01-15/*.parquet ~/Downloads/snapshot_2024_01_15/

# 2. Import using the pipeline
cd scripts/integration
./full_pipeline.sh --import ~/Downloads/snapshot_2024_01_15 2024-01-15

# 3. Start backend
cd ../../backend
uvicorn app.main:app --reload

# 4. Start frontend (new terminal)
cd ../frontend
npm run dev

# 5. Open browser
open http://localhost:3000
```

### Scenario 2: Scan Local Test Data

Testing with local mock data.

```bash
# 1. Generate test data (if not already done)
cd scanner/tests/fixtures
./generate_fixtures.sh

# 2. Run full pipeline
cd ../../../scripts/integration
./full_pipeline.sh ../../scanner/tests/fixtures/test_project 2024-01-01

# 3. Start backend
cd ../../backend
uvicorn app.main:app --reload

# 4. Start frontend
cd ../frontend
npm run dev
```

### Scenario 3: Quick Import (Skip Validation)

When you trust the parquet files and want faster import.

```bash
# Import without validation
./full_pipeline.sh --no-validate --import ~/Downloads/scan_2024_01_15 2024-01-15
```

---

## Directory Structure

After running the scripts, your directory structure will look like:

```
storage-analytics/
├── backend/
│   └── data/
│       └── snapshots/
│           ├── 2024-01-01/      # Test snapshot
│           │   └── scan.parquet
│           └── 2024-01-15/      # Server snapshot
│               ├── cil.parquet
│               ├── battuta_shares.parquet
│               └── gcp.parquet
└── scripts/
    └── integration/
        ├── validate_parquet.py
        ├── import_snapshot.py (symlink)
        └── full_pipeline.sh
```

---

## Troubleshooting

### "No parquet files found"
**Problem:** Script can't find parquet files in source directory
**Solution:** Check that you're pointing to the directory containing `.parquet` files, not the files themselves

### "Missing required columns"
**Problem:** Parquet files don't have expected schema
**Solution:** Regenerate parquet files with the scanner, or check scanner version compatibility

### "Import script not found"
**Problem:** Can't find `backend/scripts/import_snapshot.py`
**Solution:** Make sure you're running from the correct directory, or check that the file exists

### "Permission denied"
**Problem:** Scripts are not executable
**Solution:**
```bash
chmod +x validate_parquet.py
chmod +x full_pipeline.sh
chmod +x ../../backend/scripts/import_snapshot.py
```

### "Snapshot already exists"
**Problem:** Trying to import a snapshot that already exists
**Solution:**
- Answer 'yes' when prompted to overwrite
- Or manually delete: `rm -rf backend/data/snapshots/2024-01-15`

---

## Requirements

- Python 3.11+
- pyarrow package (`pip install pyarrow`)
- pandas package (`pip install pandas`)
- Scanner binary (if using scan mode): `scanner/target/release/storage-scanner`

---

## Next Steps

After importing snapshots:

1. **Start the backend:**
   ```bash
   cd backend
   uvicorn app.main:app --reload
   ```

2. **Verify API access:**
   ```bash
   curl http://localhost:8000/api/snapshots
   ```

3. **Start the frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

4. **Open dashboard:**
   ```
   http://localhost:3000
   ```

5. **Select snapshot and explore!**
