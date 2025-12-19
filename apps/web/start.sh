#!/bin/bash
# Start the CIL-rcc-tracker Web Frontend

set -e

echo "Starting CIL-rcc-tracker frontend on http://localhost:3000"
echo "API proxy configured to forward to http://localhost:8000"
echo ""

npm run dev
