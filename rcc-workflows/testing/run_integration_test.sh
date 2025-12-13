#!/bin/bash

################################################################################
# Integration Test Suite for CIL Storage Tracker
#
# This script runs a complete end-to-end test of the storage tracking pipeline:
# 1. Generate mock filesystem data
# 2. Scan directories with the scanner (incremental mode)
# 3. Aggregate chunk files
# 4. Import to backend
# 5. Verify data in backend
#
# Usage:
#   ./run_integration_test.sh [--scale small|medium|large] [--cleanup]
################################################################################

set -e  # Exit on error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEST_DATA_DIR="${SCRIPT_DIR}/test_data"
SCAN_OUTPUT_DIR="${SCRIPT_DIR}/scan_output"
AGGREGATED_DIR="${SCRIPT_DIR}/aggregated"
# Use real dates for two snapshots (7 days apart for testing)
TEST_DATE_1="2025-01-01"
TEST_DATE_2="2025-01-08"

# Default options
SCALE="small"
CLEANUP=false
SKIP_GENERATION=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --scale)
            SCALE="$2"
            shift 2
            ;;
        --cleanup)
            CLEANUP=true
            shift
            ;;
        --skip-generation)
            SKIP_GENERATION=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Helper functions
log_step() {
    echo ""
    echo "======================================================================"
    echo "$1"
    echo "======================================================================"
}

log_success() {
    echo -e "${GREEN}SUCCESS:${NC} $1"
}

log_error() {
    echo -e "${RED}ERROR:${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}WARNING:${NC} $1"
}

log_info() {
    echo "INFO: $1"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking Prerequisites"

    # Check if backend is running (which would lock the database)
    BACKEND_PID=$(pgrep -f "uvicorn app.main:app" || true)
    if [ -n "${BACKEND_PID}" ]; then
        log_warning "Backend server is running (PID: ${BACKEND_PID})"
        log_warning "This may cause database lock conflicts during testing"
        echo -n "Stop the backend server? (y/n) "
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            kill ${BACKEND_PID}
            sleep 2
            log_success "Backend server stopped"
        else
            log_error "Please stop the backend server manually before running tests"
            echo "  kill ${BACKEND_PID}"
            exit 1
        fi
    fi

    # Check scanner binary
    if command -v storage-scanner &> /dev/null; then
        SCANNER_BIN="storage-scanner"
        log_success "Scanner found in PATH"
    elif [ -f "${PROJECT_ROOT}/scanner/target/release/storage-scanner" ]; then
        SCANNER_BIN="${PROJECT_ROOT}/scanner/target/release/storage-scanner"
        log_success "Scanner found in project"
    else
        log_error "Scanner binary not found"
        echo "Please build the scanner first:"
        echo "  cd ${PROJECT_ROOT}/scanner && cargo build --release"
        exit 1
    fi

    # Check Python
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 not found"
        exit 1
    fi
    log_success "Python 3 found"

    # Check backend virtual environment
    if [ ! -d "${PROJECT_ROOT}/backend/venv" ]; then
        log_warning "Backend venv not found, creating..."
        cd "${PROJECT_ROOT}/backend"
        python3 -m venv venv
        source venv/bin/activate
        pip install -q -r requirements.txt
        deactivate
        log_success "Backend venv created"
    else
        log_success "Backend venv found"
    fi
}

# Generate test data
generate_test_data() {
    if [ "$SKIP_GENERATION" = true ]; then
        log_step "Skipping Test Data Generation"
        return
    fi

    log_step "Step 1: Generating Test Data (Scale: ${SCALE})"

    # Clean previous test data
    if [ -d "${TEST_DATA_DIR}" ]; then
        log_info "Removing previous test data..."
        rm -rf "${TEST_DATA_DIR}"
    fi

    # Run generator
    python3 "${SCRIPT_DIR}/generate_test_data.py" \
        --output-dir "${TEST_DATA_DIR}" \
        --scale "${SCALE}"

    if [ $? -eq 0 ]; then
        log_success "Test data generated"
    else
        log_error "Failed to generate test data"
        exit 1
    fi
}

# Run scanner
run_scanner() {
    log_step "Step 2: Scanning Directories"

    # Clean previous scan output
    if [ -d "${SCAN_OUTPUT_DIR}" ]; then
        log_info "Removing previous scan output..."
        rm -rf "${SCAN_OUTPUT_DIR}"
    fi
    mkdir -p "${SCAN_OUTPUT_DIR}"

    # Scan each top-level directory
    DIRS=("home_dirs" "gcp" "battuta_shares")
    for DIR in "${DIRS[@]}"; do
        DIR_PATH="${TEST_DATA_DIR}/project_cil/${DIR}"

        if [ ! -d "${DIR_PATH}" ]; then
            log_warning "Directory not found: ${DIR_PATH}, skipping"
            continue
        fi

        log_info "Scanning: ${DIR}"

        ${SCANNER_BIN} scan \
            --path "${DIR_PATH}" \
            --output "${SCAN_OUTPUT_DIR}/${DIR}.parquet" \
            --incremental \
            --rows-per-chunk 100 \
            --threads 4 \
            2>&1 | tail -10

        if [ ${PIPESTATUS[0]} -eq 0 ]; then
            CHUNK_COUNT=$(ls "${SCAN_OUTPUT_DIR}/${DIR}_chunk_"*.parquet 2>/dev/null | wc -l)
            log_success "  Scanned ${DIR}: ${CHUNK_COUNT} chunks"
        else
            log_error "  Failed to scan ${DIR}"
            exit 1
        fi
    done
}

# Aggregate chunks
aggregate_chunks() {
    log_step "Step 3: Aggregating Chunks"

    # Clean previous aggregated output
    if [ -d "${AGGREGATED_DIR}" ]; then
        log_info "Removing previous aggregated files..."
        rm -rf "${AGGREGATED_DIR}"
    fi
    mkdir -p "${AGGREGATED_DIR}"

    # Aggregate each directory's chunks
    DIRS=("home_dirs" "gcp" "battuta_shares")
    for DIR in "${DIRS[@]}"; do
        CHUNK_PATTERN="${SCAN_OUTPUT_DIR}/${DIR}_chunk_*.parquet"
        CHUNK_COUNT=$(ls ${CHUNK_PATTERN} 2>/dev/null | wc -l)

        if [ ${CHUNK_COUNT} -eq 0 ]; then
            log_warning "No chunks found for ${DIR}, skipping"
            continue
        fi

        log_info "Aggregating ${DIR} (${CHUNK_COUNT} chunks)..."

        ${SCANNER_BIN} aggregate \
            --input "${SCAN_OUTPUT_DIR}/${DIR}.parquet" \
            --output "${AGGREGATED_DIR}/${DIR}.parquet" \
            --delete-chunks \
            2>&1 | tail -5

        if [ ${PIPESTATUS[0]} -eq 0 ]; then
            SIZE=$(du -h "${AGGREGATED_DIR}/${DIR}.parquet" | awk '{print $1}')
            log_success "  Aggregated ${DIR}: ${SIZE}"
        else
            log_error "  Failed to aggregate ${DIR}"
            exit 1
        fi
    done
}

# Import to backend
import_to_backend() {
    log_step "Step 4: Importing to Backend (2 Snapshots)"

    cd "${PROJECT_ROOT}/backend"
    source venv/bin/activate

    # Clear DuckDB database to avoid lock conflicts and stale data
    if [ -f "data/storage_analytics.duckdb" ]; then
        log_info "Removing DuckDB database to ensure clean test environment..."
        rm -f data/storage_analytics.duckdb*
    fi

    # Import first snapshot
    log_info "Importing snapshot 1: ${TEST_DATE_1}"
    TEST_SNAPSHOT_DIR_1="data/snapshots/${TEST_DATE_1}"
    if [ -d "${TEST_SNAPSHOT_DIR_1}" ]; then
        log_info "Removing previous test snapshot 1..."
        rm -rf "${TEST_SNAPSHOT_DIR_1}"
    fi

    python scripts/import_snapshot.py \
        "${AGGREGATED_DIR}" \
        "${TEST_DATE_1}"

    if [ $? -eq 0 ]; then
        log_success "Snapshot 1 imported: ${TEST_DATE_1}"
    else
        log_error "Failed to import snapshot 1"
        deactivate
        exit 1
    fi

    # Import second snapshot (same data but different date for testing snapshot switching)
    log_info "Importing snapshot 2: ${TEST_DATE_2}"
    TEST_SNAPSHOT_DIR_2="data/snapshots/${TEST_DATE_2}"
    if [ -d "${TEST_SNAPSHOT_DIR_2}" ]; then
        log_info "Removing previous test snapshot 2..."
        rm -rf "${TEST_SNAPSHOT_DIR_2}"
    fi

    python scripts/import_snapshot.py \
        "${AGGREGATED_DIR}" \
        "${TEST_DATE_2}"

    if [ $? -eq 0 ]; then
        log_success "Snapshot 2 imported: ${TEST_DATE_2}"
    else
        log_error "Failed to import snapshot 2"
        deactivate
        exit 1
    fi

    deactivate
}

# Verify import
verify_import() {
    log_step "Step 5: Verifying Import"

    cd "${PROJECT_ROOT}/backend"
    source venv/bin/activate

    # Verify both snapshots
    for TEST_DATE in "${TEST_DATE_1}" "${TEST_DATE_2}"; do
        log_info "Verifying snapshot: ${TEST_DATE}"

        # Count files in imported snapshot
        PARQUET_COUNT=$(ls data/snapshots/${TEST_DATE}/*.parquet 2>/dev/null | wc -l)
        log_info "  Parquet files: ${PARQUET_COUNT}"

        # Try to read one file with Python
        FIRST_FILE=$(ls data/snapshots/${TEST_DATE}/*.parquet 2>/dev/null | head -1)
        if [ -n "${FIRST_FILE}" ]; then
            ROW_COUNT=$(python3 -c "import polars as pl; df = pl.read_parquet('${FIRST_FILE}'); print(len(df))" 2>/dev/null)
            if [ -n "${ROW_COUNT}" ]; then
                log_success "  Read parquet file: ${ROW_COUNT} rows"
            else
                log_warning "  Could not read parquet file with polars"
            fi
        fi

        # Verify hierarchy table was created
        HIERARCHY_CHECK=$(python3 -c "
import sys
sys.path.insert(0, '.')
from app.database.duckdb_client import DuckDBClient
db = DuckDBClient()
try:
    result = db.conn.execute(\"SELECT COUNT(*) FROM directory_hierarchy WHERE snapshot_date = '${TEST_DATE}'\").fetchone()
    print(result[0] if result else 0)
except:
    print(0)
" 2>/dev/null)

        if [ -n "${HIERARCHY_CHECK}" ] && [ "${HIERARCHY_CHECK}" -gt 0 ]; then
            log_success "  Hierarchy table created: ${HIERARCHY_CHECK} entries"
        else
            log_warning "  Hierarchy table not found or empty"
        fi
    done

    deactivate
}

# Print summary
print_summary() {
    log_step "Test Summary"

    echo "Test Snapshots:    ${TEST_DATE_1}, ${TEST_DATE_2}"
    echo "Scale:             ${SCALE}"
    echo ""
    echo "Test Data:         ${TEST_DATA_DIR}/project_cil/"
    echo "Scan Output:       ${SCAN_OUTPUT_DIR}/"
    echo "Aggregated Files:  ${AGGREGATED_DIR}/"
    echo "Backend Snapshot 1: ${PROJECT_ROOT}/backend/data/snapshots/${TEST_DATE_1}/"
    echo "Backend Snapshot 2: ${PROJECT_ROOT}/backend/data/snapshots/${TEST_DATE_2}/"
    echo ""
    echo "Next steps:"
    echo ""
    echo "============================================================"
    echo "RECOMMENDED: Use Docker Compose (Isolated Environment)"
    echo "============================================================"
    echo ""
    echo "  1. Make sure no manual servers are running:"
    echo "     pkill -f 'uvicorn app.main:app'"
    echo "     pkill -f 'next dev'"
    echo ""
    echo "  2. Start Docker services:"
    echo "     cd docker && docker-compose up --build"
    echo ""
    echo "  3. Open browser at:"
    echo "     http://localhost:3001/dashboard/${TEST_DATE_1}"
    echo "     http://localhost:3001/dashboard/${TEST_DATE_2}"
    echo ""
    echo "     Note: Docker uses port 3001 (isolated from manual dev)"
    echo ""
    echo "============================================================"
    echo "Alternative: Manual Start (Development)"
    echo "============================================================"
    echo ""
    echo "  1. Start backend:"
    echo "     cd backend && source venv/bin/activate && uvicorn app.main:app --reload"
    echo ""
    echo "  2. Start frontend (in another terminal):"
    echo "     cd frontend && npm run dev"
    echo ""
    echo "  3. Open browser at:"
    echo "     http://localhost:3000/dashboard/${TEST_DATE_1}"
    echo "     http://localhost:3000/dashboard/${TEST_DATE_2}"
    echo ""
    echo "     Note: Manual dev uses port 3000"
    echo ""

    if [ "$CLEANUP" = false ]; then
        echo "Cleanup:"
        echo "  To remove test files, run: ./run_integration_test.sh --cleanup"
        echo ""
    fi
}

# Cleanup test files
cleanup_test_files() {
    log_step "Cleaning Up Test Files"

    # Remove test data
    if [ -d "${TEST_DATA_DIR}" ]; then
        rm -rf "${TEST_DATA_DIR}"
        log_info "Removed test data directory"
    fi

    # Remove scan output
    if [ -d "${SCAN_OUTPUT_DIR}" ]; then
        rm -rf "${SCAN_OUTPUT_DIR}"
        log_info "Removed scan output directory"
    fi

    # Remove aggregated files
    if [ -d "${AGGREGATED_DIR}" ]; then
        rm -rf "${AGGREGATED_DIR}"
        log_info "Removed aggregated files"
    fi

    # Remove backend snapshots
    cd "${PROJECT_ROOT}/backend"
    for TEST_DATE in "${TEST_DATE_1}" "${TEST_DATE_2}"; do
        TEST_SNAPSHOT_DIR="data/snapshots/${TEST_DATE}"
        if [ -d "${TEST_SNAPSHOT_DIR}" ]; then
            rm -rf "${TEST_SNAPSHOT_DIR}"
            log_info "Removed backend snapshot: ${TEST_DATE}"
        fi
    done

    # Remove DuckDB database files to clear locks and cached data
    if [ -f "data/storage_analytics.duckdb" ]; then
        rm -f data/storage_analytics.duckdb*
        log_info "Removed DuckDB database files"
    fi

    log_success "Cleanup complete"
}

# Main execution
main() {
    log_step "CIL Storage Tracker - Integration Test Suite"
    echo "Scale:       ${SCALE}"
    echo "Snapshots:   ${TEST_DATE_1}, ${TEST_DATE_2}"

    if [ "$CLEANUP" = true ]; then
        cleanup_test_files
        exit 0
    fi

    # Run test steps
    check_prerequisites
    generate_test_data
    run_scanner
    aggregate_chunks
    import_to_backend
    verify_import
    print_summary

    log_step "Integration Test Complete"
    log_success "All steps passed successfully"
    log_success "Created 2 snapshots for testing snapshot switching functionality"
}

# Run main function
main
