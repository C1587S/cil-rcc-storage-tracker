#!/bin/bash

# Development environment setup script for Storage Analytics Backend

set -e

echo "Setting up Storage Analytics Backend development environment"
echo "============================================================"

# Check Python version
echo "Checking Python version..."
python_version=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
required_version="3.11"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo "Error: Python 3.11 or higher is required (found: $python_version)"
    exit 1
fi

echo "Python version OK: $python_version"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3.11 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements-dev.txt

# Create data directories
echo "Creating data directories..."
mkdir -p data/snapshots

# Copy environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file from example..."
    cp .env.example .env
    echo "Please edit .env file with your configuration"
fi

# Run tests to verify installation
echo "Running tests to verify installation..."
PYTHONPATH=. pytest tests/ -v

echo ""
echo "Setup complete!"
echo ""
echo "To activate the environment, run:"
echo "  source venv/bin/activate"
echo ""
echo "To start the development server, run:"
echo "  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo "API documentation will be available at:"
echo "  http://localhost:8000/docs"
