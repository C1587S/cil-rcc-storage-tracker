#!/bin/bash

# Conda environment setup script for Storage Analytics Backend

set -e

echo "Setting up Storage Analytics Backend with Conda"
echo "=============================================="

ENV_NAME="storage-analytics"

# Check if conda is installed
if ! command -v conda &> /dev/null; then
    echo "Error: conda is not installed"
    echo "Please install Miniconda or Anaconda first"
    exit 1
fi

# Remove existing environment if it exists
if conda env list | grep -q "^${ENV_NAME} "; then
    echo "Removing existing environment: ${ENV_NAME}"
    conda env remove -n ${ENV_NAME} -y
fi

# Create conda environment
echo "Creating conda environment: ${ENV_NAME}"
conda create -n ${ENV_NAME} python=3.11 -y

# Activate environment
echo "Activating environment..."
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate ${ENV_NAME}

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
fi

echo ""
echo "Setup complete!"
echo ""
echo "To activate the environment, run:"
echo "  conda activate ${ENV_NAME}"
echo ""
echo "To start the development server, run:"
echo "  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo "API documentation will be available at:"
echo "  http://localhost:8000/docs"
