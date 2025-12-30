# RCC Storage Tracker

**Complete workflow**: Scan filesystem on RCC → Download Parquet files → Deploy dashboard on cloud server

---

## Overview

A system to track 400+ TB of storage at UChicago RCC:
- **Scanner** (Rust): Scans filesystem, generates Parquet snapshots
- **Database** (ClickHouse): Stores 74M+ entries, <0.1s queries
- **Dashboard** (Next.js): Dark/light mode, interactive Voronoi treemap

---

## Complete Workflow (RCC to Cloud)

### Step 1: Generate Scan Report on RCC

**On RCC login node:**

```bash
# Clone repository
git clone <repo-url> ~/storage-tracker
cd ~/storage-tracker/scanner

# Build scanner
module load rust
cargo build --release

# Run parallel scan (recommended for large filesystems)
cd scripts
./scan_cil_parallel.sh
```

This creates Parquet files in structure like:
```
cil_scans/
├── battuta_shares/2025-12-27/
│   ├── part-00000.parquet
│   └── part-00001.parquet
├── sacagawea_shares/2025-12-27/
│   └── part-00000.parquet
└── ...
```

**Scanner options** (for manual runs):
```bash
# Basic scan
./target/release/storage-scanner \
  --path /project/cil/battuta_shares \
  --output scan.parquet

# Faster: Skip checksums, limit depth
./target/release/storage-scanner \
  --path /project/cil \
  --output scan.parquet \
  --no-checksums \
  --max-depth 10
```

See [scanner/README.md](scanner/README.md) for performance tuning.

---

### Step 2: Download Parquet Files to Local Machine

**From your local machine:**

```bash
# Download scans from RCC
rsync -avz --progress \
  <your-cnetid>@midway3.rcc.uchicago.edu:~/storage-tracker/cil_scans/ \
  ./cil_scans/
```

Or use Globus transfer for large files.

**IMPORTANT**: Parquet files stay on your local machine. You will upload them to the cloud server in Step 3.

---

### Step 3: Deploy Dashboard on Cloud Server

**Option A: Oracle Cloud Free Tier (Recommended - $0/month)**

1. **Create VM** at [cloud.oracle.com](https://cloud.oracle.com)
   - Shape: `VM.Standard.A1.Flex` (4 vCPU, 24GB RAM) - Always Free
   - OS: Ubuntu 22.04
   - Storage: 200GB boot volume

2. **Initial setup on cloud VM:**

**SSH into the VM, then:**

```bash
# Install Docker
sudo apt update && sudo apt install -y docker.io docker-compose-v2

# Add your user to docker group (to run without sudo)
sudo usermod -aG docker $USER
newgrp docker

# Clone repo
git clone <repo-url> storage-tracker
cd storage-tracker
```

3. **Upload Parquet files from your local machine to the cloud VM:**

**From your LOCAL machine** (not the VM):

```bash
# Upload scans to cloud server
rsync -avz --progress \
  ./cil_scans/ \
  ubuntu@<VM_PUBLIC_IP>:~/storage-tracker/cil_scans/
```

This uploads the Parquet files to the server in the `cil_scans/` directory.

4. **Start services on cloud VM:**

```bash
docker compose up -d
```

This starts ClickHouse, API, and Web frontend.

5. **Initialize database (FIRST TIME ONLY):**

```bash
docker compose exec clickhouse clickhouse-client < clickhouse/schema/01_create_tables.sql
docker compose exec clickhouse clickhouse-client < clickhouse/schema/02_materialized_views.sql
docker compose exec clickhouse clickhouse-client < clickhouse/schema/03_recursive_directory_sizes.sql
docker compose exec clickhouse clickhouse-client < clickhouse/schema/04_voronoi_precomputed.sql
```

**NOTE**: You only run these SQL files ONCE when first setting up the database. They create the tables and views. The database persists in Docker volumes.

6. **Import scans into ClickHouse:**

```bash
# Import all snapshots automatically
./scripts/docker-import.sh
```

**What this does:**
- Scans `cil_scans/` directory for all Parquet files
- For each snapshot date (e.g., 2025-12-27):
  - Imports Parquet files into ClickHouse `filesystem.entries` table
  - Computes recursive directory sizes
  - Generates Voronoi visualization data
- **IMPORTANT**: Each import APPENDS data. If you import the same date twice, you'll get duplicates.
- To re-import a date cleanly, first delete old data:
  ```bash
  docker compose exec clickhouse clickhouse-client --query \
    "ALTER TABLE filesystem.entries DELETE WHERE snapshot_date='2025-12-27'"
  ```

**Manual import (alternative):**
```bash
# Import single snapshot
docker compose run --rm importer python scripts/import_snapshot.py \
  /scans/battuta/2025-12-27 2025-12-27

# Compute directory sizes
docker compose run --rm importer python scripts/compute_recursive_sizes_v2.py 2025-12-27

# Generate Voronoi
docker compose run --rm importer python scripts/compute_voronoi_unified.py 2025-12-27

# Optimize table
docker compose exec clickhouse clickhouse-client --query \
  "OPTIMIZE TABLE filesystem.directory_hierarchy FINAL"
```

7. **Open firewall:**

```bash
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

If `netfilter-persistent` is not installed:
```bash
sudo apt install iptables-persistent
```

8. **Access dashboard:**

Open browser: `http://<VM_PUBLIC_IP>:3000`

**Option B: Hetzner Cloud ($4.50/month)**

- Server: CX21 (2 vCPU, 4GB RAM, 40GB SSD)
- Follow same steps as Oracle
- Memory limits in `docker-compose.yml`:
  ```yaml
  services:
    clickhouse:
      mem_limit: 2.5g
    api:
      mem_limit: 512m
    web:
      mem_limit: 512m
  ```

**Option C: Oracle On-Demand with Auto-Shutdown ($2-9/month)**

- Use when you need 12GB+ RAM but only run occasionally
- Set up idle timeout or scheduled shutdown
- See [CLAUDE.md](CLAUDE.md) for auto-shutdown scripts

---

### Step 4: Add Custom Domain (Optional)

Using Cloudflare (free plan):

1. Buy domain (~$10/year)
2. Add to Cloudflare, then DNS settings:
   - Type: `A`
   - Name: `tracker`
   - Content: `<VM_PUBLIC_IP>`
   - Proxy: Enabled (orange cloud)
3. Access: `https://tracker.yourdomain.com`

**Or use Cloudflare Tunnel (no public IP needed):**
```bash
cloudflared tunnel create storage-tracker
cloudflared tunnel route dns storage-tracker tracker.yourdomain.com
cloudflared tunnel run storage-tracker
```

---

## Data Management

### How Data Flows

```
RCC Filesystem
    ↓ (Scanner)
Parquet Files (cil_scans/)
    ↓ (rsync to local)
Local Machine (cil_scans/)
    ↓ (rsync to cloud VM)
Cloud VM (cil_scans/)
    ↓ (docker-import.sh)
ClickHouse Database (Docker volume)
    ↓ (API queries)
Dashboard (Browser)
```

### Database Persistence

- **ClickHouse data persists** in Docker volumes even after `docker compose down`
- Database is NOT reset when importing new scans
- Each import ADDS data to the database
- To delete a snapshot:
  ```bash
  docker compose exec clickhouse clickhouse-client --query \
    "ALTER TABLE filesystem.entries DELETE WHERE snapshot_date='2025-12-27'"
  ```

### Updating Scans

**1. Run new scan on RCC**
```bash
cd ~/storage-tracker/scanner/scripts
./scan_cil_parallel.sh  # Creates cil_scans/*/2025-12-XX/
```

**2. Download new files to local machine**
```bash
rsync -avz <cnetid>@midway3:~/storage-tracker/cil_scans/ ./cil_scans/
```

**3. Upload to cloud server**
```bash
rsync -avz ./cil_scans/ ubuntu@<VM_IP>:~/storage-tracker/cil_scans/
```

**4. Import on server**
```bash
ssh ubuntu@<VM_IP>
cd ~/storage-tracker
./scripts/docker-import.sh  # Auto-detects new dates
```

---

## Project Structure

```
storage-tracker/
├── scanner/              # Rust filesystem scanner
│   ├── src/             # Scanner source code
│   └── scripts/         # scan_cil_parallel.sh (RCC)
├── clickhouse/          # Database layer
│   ├── schema/          # SQL table definitions (run once)
│   ├── scripts/         # Import/processing scripts
│   └── data/            # ClickHouse data (Docker volume)
├── apps/
│   ├── api/             # FastAPI backend
│   └── web/             # Next.js dashboard
├── cil_scans/           # Parquet files (upload to server)
│   └── <source>/YYYY-MM-DD/*.parquet
├── scripts/
│   └── docker-import.sh # One-command import
└── docker-compose.yml   # All-in-one deployment
```

---

## Maintenance

**View logs:**
```bash
docker compose logs -f
```

**Restart services:**
```bash
docker compose restart
```

**Update dashboard code:**
```bash
git pull
docker compose build
docker compose up -d
```

**Check database size:**
```bash
docker compose exec clickhouse clickhouse-client --query \
  "SELECT formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE database='filesystem'"
```

**List imported snapshots:**
```bash
docker compose exec clickhouse clickhouse-client --query \
  "SELECT snapshot_date, count() as entries FROM filesystem.entries GROUP BY snapshot_date ORDER BY snapshot_date DESC"
```

**Regenerate Voronoi (if file counts show 0):**
```bash
docker compose run --rm importer python scripts/compute_voronoi_unified.py 2025-12-27 --force
```

**Delete a snapshot:**
```bash
docker compose exec clickhouse clickhouse-client --query \
  "ALTER TABLE filesystem.entries DELETE WHERE snapshot_date='2025-12-27'"
docker compose exec clickhouse clickhouse-client --query \
  "OPTIMIZE TABLE filesystem.entries FINAL"
```

---

## Cost Comparison

| Option | vCPUs | RAM | Storage | Cost/month |
|--------|-------|-----|---------|-----------|
| Oracle Free | 4 (ARM) | 24GB | 200GB | $0 |
| Oracle On-Demand (4h/day) | 2 (ARM) | 12GB | 100GB | $4.56 |
| Hetzner CX21 | 2 (x86) | 4GB | 40GB | $4.50 |
| + Domain (optional) | - | - | - | +$0.83/month |

**Recommendation**: Oracle Cloud Free Tier (24/7 dashboard, $0/month)

---

## Troubleshooting

**Scanner fails on RCC:**
```bash
# Check quotas
quota -s
df -h /project/cil

# Run on compute node instead
srun --partition=bigmem --time=4:00:00 --mem=16G --pty bash
```

**Import fails:**
```bash
# Check Parquet file structure
docker compose run --rm importer python -c \
  "import polars as pl; print(pl.read_parquet('/scans/battuta/2025-12-27/part-00000.parquet').schema)"

# Check ClickHouse is running
docker compose exec clickhouse clickhouse-client --query "SELECT 1"
```

**Dashboard shows "No snapshots":**
```bash
# Verify data imported
docker compose exec clickhouse clickhouse-client --query \
  "SELECT snapshot_date, count() FROM filesystem.entries GROUP BY snapshot_date"

# Check API is running
curl http://localhost:8000/api/snapshots
```

**File counts show 0 in Voronoi:**
```bash
# Regenerate Voronoi with --force flag
docker compose run --rm importer python scripts/compute_voronoi_unified.py 2025-12-27 --force
```

**Cannot connect to ClickHouse:**
```bash
# Check if container is running
docker compose ps

# Check ClickHouse logs
docker compose logs clickhouse

# Verify ClickHouse is responding
docker compose exec clickhouse clickhouse-client --query "SELECT 1"

# Check network connectivity from API
docker compose exec api ping clickhouse

# Restart ClickHouse
docker compose restart clickhouse
```

**Port already in use:**
```bash
# Find process using the port
lsof -i :3000 :8000 :9000

# Kill the process or change ports in docker-compose.yml
# Example: Change web port to 3001
services:
  web:
    ports:
      - "3001:3000"
```

**Out of memory:**
```bash
# Increase Docker memory limit in Docker Desktop settings
# Recommended: At least 4GB for full stack

# Or reduce ClickHouse memory usage in docker-compose.yml:
environment:
  CLICKHOUSE_MAX_MEMORY_USAGE: 2000000000  # 2GB
```

---

## Local Development

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB RAM available
- 10GB disk space

### Development Workflow

**Option 1: Full Docker Stack (Recommended for Testing)**

```bash
# Start everything
docker compose up -d

# Watch logs
docker compose logs -f api web

# Make code changes, then rebuild
docker compose build api web
docker compose up -d
```

**Option 2: Hybrid (ClickHouse in Docker, Dev Servers Local)**

```bash
# Start only ClickHouse
docker compose up -d clickhouse

# Run API locally
cd apps/api
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Run web locally (in another terminal)
cd apps/web
npm run dev
```

This provides faster iteration during development.

---

## Additional Documentation

- **CLAUDE.md** - Cloud deployment options + auto-shutdown
- **scanner/README.md** - Scanner performance tuning
- **clickhouse/scripts/README.md** - Import script options

---

## Quick Reference

**RCC to Cloud workflow:**
```bash
# 1. On RCC: Scan
cd ~/storage-tracker/scanner/scripts
./scan_cil_parallel.sh

# 2. On local machine: Download from RCC
rsync -avz <cnetid>@midway3:~/storage-tracker/cil_scans/ ./cil_scans/

# 3. On local machine: Upload to cloud VM
rsync -avz ./cil_scans/ ubuntu@<VM_IP>:~/storage-tracker/cil_scans/

# 4. On cloud VM: Import
ssh ubuntu@<VM_IP>
cd ~/storage-tracker
./scripts/docker-import.sh

# 5. Access dashboard
# Open browser: http://<VM_IP>:3000
```

**First-time cloud setup:**
```bash
# On cloud VM
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone <repo> && cd storage-tracker
docker compose up -d
# Run SQL schema files (once)
# Import scans
```

**Performance:** 50K+ files/sec scanning, <0.1s queries, 74M entries
