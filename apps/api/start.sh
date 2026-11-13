#!/bin/bash
# Start the CIL-rcc-tracker API server

set -e

# Activate virtual environment
source venv/bin/activate

# Start server
echo "Starting CIL-rcc-tracker API server on http://localhost:8000"
echo "API docs available at http://localhost:8000/docs"
echo ""

# Local development: docs on, listen on localhost only.
export API_DOCS="${API_DOCS:-true}"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
