#!/bin/bash

# Test execution script

set -e

echo "Running Storage Analytics Backend Tests"
echo "========================================"

# Generate test data
echo "Generating test data..."
python tests/fixtures/generate_test_data.py

# Run pytest with coverage
echo "Running tests with coverage..."
pytest tests/ \
    -v \
    --cov=app \
    --cov-report=term-missing \
    --cov-report=html \
    --cov-report=xml

echo ""
echo "Test Results:"
echo "  HTML coverage report: htmlcov/index.html"
echo "  XML coverage report: coverage.xml"
