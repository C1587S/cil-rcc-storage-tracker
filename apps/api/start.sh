#!/bin/bash
# Start the CIL-rcc-tracker API server

set -e

# Activate virtual environment
source venv/bin/activate

# Start server
echo "Starting CIL-rcc-tracker API server on http://localhost:8000"
echo "API docs available at http://localhost:8000/docs"
echo ""

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
