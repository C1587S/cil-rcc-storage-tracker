FROM python:3.11-slim

# Run as root to avoid permission issues with mounted volumes
USER root

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy scripts
COPY scripts/ /app/scripts/

# Default command shows usage
CMD ["python", "-c", "print('Usage: docker compose run importer <command>')"]
