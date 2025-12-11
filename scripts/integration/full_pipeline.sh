#!/bin/bash
#
# Full Pipeline Script - Local Development
#
# This script automates the complete workflow:
# 1. Scan a directory (or use existing parquet files)
# 2. Validate parquet output
# 3. Import to backend
# 4. Verify backend can access the data
#
# Usage:
#   ./full_pipeline.sh <source_path> <snapshot_date>
#
# Examples:
#   # Scan a directory
#   ./full_pipeline.sh /path/to/scan 2024-01-15
#
#   # Import existing parquet files
#   ./full_pipeline.sh --import /path/to/parquet/files 2024-01-15
#
# Options:
#   --import    Skip scanning, import existing parquet files
#   --skip-scan Skip scanning step
#   --no-validate Skip validation step
#

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Default paths
SCANNER_BIN="$PROJECT_ROOT/scanner/target/release/storage-scanner"
VALIDATE_SCRIPT="$SCRIPT_DIR/validate_parquet.py"
IMPORT_SCRIPT="$PROJECT_ROOT/backend/scripts/import_snapshot.py"
TEMP_SCAN_DIR="${TEMP_SCAN_DIR:-/tmp/storage_analytics_scan}"

# Options
SKIP_SCAN=false
SKIP_VALIDATE=false
IMPORT_MODE=false

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo "============================================================"
    echo "$1"
    echo "============================================================"
    echo ""
}

print_separator() {
    echo ""
    echo "------------------------------------------------------------"
    echo ""
}

check_dependencies() {
    log_info "Checking dependencies..."

    # Check Python
    if ! command -v python3 &> /dev/null; then
        log_error "python3 not found. Please install Python 3.11+"
        exit 1
    fi

    # Check scanner (if not in import mode)
    if [ "$IMPORT_MODE" = false ] && [ "$SKIP_SCAN" = false ]; then
        if [ ! -f "$SCANNER_BIN" ]; then
            log_error "Scanner binary not found at: $SCANNER_BIN"
            log_info "Build it with: cd scanner && cargo build --release"
            exit 1
        fi
    fi

    # Check validation script
    if [ "$SKIP_VALIDATE" = false ] && [ ! -f "$VALIDATE_SCRIPT" ]; then
        log_warning "Validation script not found at: $VALIDATE_SCRIPT"
        log_warning "Skipping validation step"
        SKIP_VALIDATE=true
    fi

    # Check import script
    if [ ! -f "$IMPORT_SCRIPT" ]; then
        log_error "Import script not found at: $IMPORT_SCRIPT"
        exit 1
    fi

    log_success "All dependencies found"
}

scan_directory() {
    local source_path="$1"
    local output_dir="$2"

    print_header "Step 1: Scanning Directory"

    log_info "Source: $source_path"
    log_info "Output: $output_dir"

    # Create output directory
    mkdir -p "$output_dir"

    # Determine thread count
    local threads=${SCANNER_THREADS:-16}
    if command -v nproc &> /dev/null; then
        threads=$(nproc)
    elif command -v sysctl &> /dev/null; then
        threads=$(sysctl -n hw.ncpu 2>/dev/null || echo 16)
    fi

    log_info "Using $threads threads"

    # Run scanner
    log_info "Starting scan..."
    "$SCANNER_BIN" scan \
        --path "$source_path" \
        --output "$output_dir/scan.parquet" \
        --threads "$threads" \
        --verbose

    if [ $? -eq 0 ]; then
        log_success "Scan completed successfully"
    else
        log_error "Scan failed"
        exit 1
    fi
}

validate_parquet() {
    local parquet_dir="$1"

    print_header "Step 2: Validating Parquet Files"

    log_info "Running validation..."

    python3 "$VALIDATE_SCRIPT" "$parquet_dir"

    if [ $? -eq 0 ]; then
        log_success "Validation passed"
    else
        log_error "Validation failed"
        exit 1
    fi
}

import_to_backend() {
    local parquet_dir="$1"
    local snapshot_date="$2"

    print_header "Step 3: Importing to Backend"

    log_info "Importing snapshot: $snapshot_date"

    python3 "$IMPORT_SCRIPT" "$parquet_dir" "$snapshot_date"

    if [ $? -eq 0 ]; then
        log_success "Import completed successfully"
    else
        log_error "Import failed"
        exit 1
    fi
}

verify_backend() {
    local snapshot_date="$1"

    print_header "Step 4: Verifying Backend Access"

    log_info "Checking if backend can access snapshot..."

    # List snapshots
    python3 "$IMPORT_SCRIPT" --list

    log_success "Backend verification complete"
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS] <source_path> <snapshot_date>

Automate the complete storage analytics pipeline:
  1. Scan directory (or use existing parquet files)
  2. Validate parquet output
  3. Import to backend
  4. Verify backend can access the data

Arguments:
  source_path      Path to scan OR path to existing parquet files
  snapshot_date    Snapshot identifier (YYYY-MM-DD format)

Options:
  --import         Import existing parquet files (skip scanning)
  --skip-scan      Skip scanning step
  --no-validate    Skip validation step
  -h, --help       Show this help message

Environment Variables:
  SCANNER_THREADS  Number of threads for scanner (default: auto-detect)
  TEMP_SCAN_DIR    Temporary directory for scans (default: /tmp/storage_analytics_scan)

Examples:
  # Scan and import a directory
  $0 /path/to/data 2024-01-15

  # Import existing parquet files
  $0 --import /path/to/parquet/files 2024-01-15

  # Scan with custom thread count
  SCANNER_THREADS=32 $0 /path/to/data 2024-01-15

  # Skip validation (faster)
  $0 --no-validate /path/to/data 2024-01-15

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --import)
            IMPORT_MODE=true
            SKIP_SCAN=true
            shift
            ;;
        --skip-scan)
            SKIP_SCAN=true
            shift
            ;;
        --no-validate)
            SKIP_VALIDATE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            break
            ;;
    esac
done

# Validate arguments
if [ $# -ne 2 ]; then
    log_error "Invalid number of arguments"
    usage
    exit 1
fi

SOURCE_PATH="$1"
SNAPSHOT_DATE="$2"

# Validate snapshot date format
if ! [[ "$SNAPSHOT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    log_error "Invalid snapshot date format. Use YYYY-MM-DD"
    exit 1
fi

# Main execution
print_header "Storage Analytics Pipeline"
log_info "Source: $SOURCE_PATH"
log_info "Snapshot Date: $SNAPSHOT_DATE"
log_info "Mode: $([ "$IMPORT_MODE" = true ] && echo "Import" || echo "Scan & Import")"

# Check dependencies
check_dependencies

# Determine working directory
if [ "$IMPORT_MODE" = true ]; then
    PARQUET_DIR="$SOURCE_PATH"
    log_info "Using existing parquet files from: $PARQUET_DIR"
else
    PARQUET_DIR="$TEMP_SCAN_DIR/$SNAPSHOT_DATE"
    log_info "Scan output directory: $PARQUET_DIR"
fi

# Step 1: Scan (if not in import mode)
if [ "$SKIP_SCAN" = false ]; then
    scan_directory "$SOURCE_PATH" "$PARQUET_DIR"
fi

# Step 2: Validate
if [ "$SKIP_VALIDATE" = false ]; then
    validate_parquet "$PARQUET_DIR"
else
    log_warning "Skipping validation step"
fi

# Step 3: Import
import_to_backend "$PARQUET_DIR" "$SNAPSHOT_DATE"

# Step 4: Verify
verify_backend "$SNAPSHOT_DATE"

# Summary
print_separator
log_success "Pipeline completed successfully!"
echo ""
echo "Next steps:"
echo "  1. Start the backend: cd backend && uvicorn app.main:app --reload"
echo "  2. Start the frontend: cd frontend && npm run dev"
echo "  3. Open http://localhost:3000 and select snapshot: $SNAPSHOT_DATE"
echo ""
print_separator
