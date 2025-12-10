#!/bin/bash

# Benchmark runner script for storage scanner
# Runs Criterion benchmarks and generates performance reports

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================="
echo "Storage Scanner - Benchmark Suite"
echo "========================================="
echo ""

cd "$PROJECT_DIR"

# Check if cargo is available
if ! command -v cargo &> /dev/null; then
    echo "Error: cargo not found. Please install Rust."
    exit 1
fi

echo "Building benchmarks in release mode..."
cargo build --release --benches

echo ""
echo "Running benchmark suite..."
echo "This may take several minutes..."
echo ""

# Run benchmarks and save output
BENCHMARK_OUTPUT="benchmark_results_$(date +%Y%m%d_%H%M%S).txt"

cargo bench --bench scan_benchmark 2>&1 | tee "$BENCHMARK_OUTPUT"

echo ""
echo "========================================="
echo "Benchmark Results"
echo "========================================="
echo ""

# Parse and display key results
echo "Summary of benchmark results:"
echo ""

if [ -f "$BENCHMARK_OUTPUT" ]; then
    grep -A 1 "time:" "$BENCHMARK_OUTPUT" || echo "No timing results found"
fi

echo ""
echo "Detailed results saved to: $BENCHMARK_OUTPUT"
echo ""

# Check if Criterion HTML reports exist
if [ -d "target/criterion" ]; then
    REPORT_DIR="$(pwd)/target/criterion"
    echo "HTML reports generated in: $REPORT_DIR"
    echo ""
    echo "View detailed charts and graphs:"

    # Find the main report index
    if [ -f "$REPORT_DIR/report/index.html" ]; then
        REPORT_PATH="$REPORT_DIR/report/index.html"
        echo "  Main report: file://$REPORT_PATH"

        # Try to open in browser (macOS)
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo ""
            read -p "Open benchmark report in browser? (y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                open "$REPORT_PATH"
            fi
        fi
    fi

    echo ""
    echo "Individual benchmark reports:"
    find "$REPORT_DIR" -name "index.html" -not -path "*/report/index.html" | while read -r report; do
        echo "  file://$report"
    done
fi

echo ""
echo "========================================="
echo "Performance Summary"
echo "========================================="
echo ""

# Extract performance metrics if available
if [ -f "$BENCHMARK_OUTPUT" ]; then
    echo "Files per second (approximate):"
    grep -o "[0-9,]\\+ elements" "$BENCHMARK_OUTPUT" | head -3 || true
    echo ""

    echo "Throughput comparison:"
    grep "thrpt:" "$BENCHMARK_OUTPUT" | tail -5 || echo "No throughput data available"
fi

echo ""
echo "Benchmark run complete!"
echo ""
echo "To run specific benchmarks:"
echo "  cargo bench -- scan_small_files"
echo "  cargo bench -- scan_nested"
echo "  cargo bench -- parallel_comparison"
echo ""
