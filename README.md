# RCC Storage Tracker

**Complete workflow**: Scan filesystem on RCC, download Parquet files, deploy dashboard on cloud server

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

### Step 2: Publish and Clean (Automated Daily Pipeline)

The daily pipeline runs automatically every night at 2am. It scans all directories in parallel, publishes results to a public URL on Midway2, and cleans scratch when done.

**First-time setup on Midway2 (run once):**

```bash
ssh midway2.rcc.uchicago.edu
chmod o+x $HOME
mkdir -p $HOME/public_html
chmod o+x $HOME/public_html
```

**Start the daily pipeline (run once to activate):**

```bash
sbatch --begin=02:00 scanner/scripts/daily_pipeline.sh
```

After that it resubmits itself automatically every day. To stop it:

```bash
scancel <job_id>  # find it with: squeue -u $USER
```

**To run the pipeline manually on demand (from Midway2):**

```bash
bash scanner/scripts/publish_scans.sh --clean
```

This copies all scan results to `public_html`, makes them available at the URL below, and cleans scratch when done.

Scan results are published at:
```
http://users.rcc.uchicago.edu/~[your_CNetID]/cil_scans/
```

---

### Step 3: Download Parquet Files to Local Machine

**From your local machine (downloads via RCC public_html):**

```bash
./scanner/scripts/download-scans.sh
```

This script:
- Auto-detects the latest scan date from the public URL
- Downloads all parquet chunks into `cil_scans/<source>/<date>/`
- Validates every file (deletes and re-downloads any corrupted ones)
- Skips files already present (safe to re-run)

**Alternative: rsync directly from RCC:**
```bash
rsync -avz --progress \
  <your-cnetid>@midway3.rcc.uchicago.edu:/scratch/midway3/<cnetid>/cil_scans/ \
  ./cil_scans/
```

**IMPORTANT**: Parquet files stay on your local machine. You will upload them to the cloud server in Step 4.

---

### Step 4: Deploy Dashboard on Cloud Server

**Option A: Oracle Cloud Free Tier (Recommended - $0/month)**

1. **Create VM** at [cloud.oracle.com](https://cloud.oracle.com)
   - Shape: `VM.Standard.A1.Flex` (4 vCPU, 24GB RAM) - Always Free
   - OS: Ubuntu 22.04
   - Storage: 200GB boot volume

2. **Initial setup on cloud VM:**

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
rsync -avz --progress \
  ./cil_scans/ \
  ubuntu@<VM_PUBLIC_IP>:~/storage-tracker/cil_scans/
```

4. **Start services on cloud VM:**

```bash
docker compose up -d
```

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

---

### Step 5: Add Custom Domain (Optional)

Using Cloudflare (free plan):

1. Buy domain (~$10/year)
2. Add to Cloudflare, then DNS settings:
   - Type: `A`
   - Name: `tracker`
   - Content: `<VM_PUBLIC_IP>`
   - Proxy: Enabled (orange cloud)
3. Access: `https://tracker.yourdomain.com`

**Or use Cloudflare Tunnel (no public IP needed, recommended for local machine):**

Install cloudflared:
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin
```

One-time setup:
```bash
cloudflared tunnel login
cloudflared tunnel create dev-tracker
# Note the tunnel ID printed (e.g. 367f2abe-...)
```

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: dev-tracker
credentials-file: /home/<user>/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: your-domain.com
    path: /cil-rcc-tracker
    service: http://localhost:3000
  - service: http_status:404
```

Route DNS and start:
```bash
cloudflared tunnel route dns dev-tracker your-domain.com
```

Set up as a systemd service (auto-start on boot, auto-restart on crash):
```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/cloudflared.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel (dev-tracker)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/cloudflared tunnel run dev-tracker
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable cloudflared
systemctl --user start cloudflared

# Keep service running after logout
loginctl enable-linger $USER
```

Manage:
```bash
systemctl --user status cloudflared     # check status
systemctl --user restart cloudflared    # restart
systemctl --user stop cloudflared       # stop
journalctl --user -u cloudflared -f     # view logs
```

Access: `https://your-domain.com/cil-rcc-tracker`

**Note**: The app must be built with the correct `NEXT_PUBLIC_BASE_PATH` matching the subpath. This is already configured in `docker-compose.yml` as `/cil-rcc-tracker`.

---

## Data Management

### How Data Flows

```
RCC Filesystem
    |
    | (Scanner)
    v
Parquet Files in scratch (midway3)
    |
    | (daily_pipeline.sh)
    v
public_html on Midway2 (HTTP)
    |
    | (download-scans.sh)
    v
Local Machine (cil_scans/)
    |
    | (rsync to cloud VM)
    v
Cloud VM (cil_scans/)
    |
    | (docker-import.sh)
    v
ClickHouse Database (Docker volume)
    |
    | (API queries)
    v
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

### Managing Snapshots

> All commands below run **from the project root on your local machine** (where `docker-compose.yml` lives).
> You do NOT need to enter any container — `docker compose exec` sends the command into the running `clickhouse` container for you.

**List all snapshots in the database:**
```bash
docker compose exec clickhouse clickhouse-client --query \
  "SELECT snapshot_date, formatReadableQuantity(count()) as entries
   FROM filesystem.entries
   GROUP BY snapshot_date
   ORDER BY snapshot_date DESC"
```

**Delete a specific snapshot (keeps everything else):**
```bash
DATE="2025-12-27"
for table in entries directory_hierarchy voronoi_precomputed snapshots; do
  docker compose exec clickhouse clickhouse-client --query \
    "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${DATE}'"
done
docker compose exec clickhouse clickhouse-client --query \
  "OPTIMIZE TABLE filesystem.entries FINAL"
```

**Keep only the latest snapshot (delete all others):**
```bash
LATEST=$(docker compose exec clickhouse clickhouse-client --query \
  "SELECT max(snapshot_date) FROM filesystem.entries" | tr -d '\r')

echo "Keeping: ${LATEST}"

for table in entries directory_hierarchy voronoi_precomputed snapshots; do
  docker compose exec clickhouse clickhouse-client --query \
    "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date != '${LATEST}'"
done
docker compose exec clickhouse clickhouse-client --query \
  "OPTIMIZE TABLE filesystem.entries FINAL"
echo "Done. Only ${LATEST} remains."
```

**Replace the current snapshot with a new one:**
```bash
NEW_DATE="2026-03-05"

# 1. Delete old data for this date (if re-importing)
for table in entries directory_hierarchy voronoi_precomputed snapshots; do
  docker compose exec clickhouse clickhouse-client --query \
    "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${NEW_DATE}'"
done

# 2. Import fresh
./scripts/docker-import.sh
```

---

### Automated Updates

Two scripts handle the full update lifecycle:

| Script | Purpose |
|--------|---------|
| `scripts/update-snapshot.sh` | Downloads latest, imports, deletes old — run manually or via cron |
| `scripts/setup-cron.sh` | Installs cron jobs (5am / noon / 9pm daily) |

**Manual update (run once to test):**
```bash
# From project root — downloads latest, imports, deletes old snapshot automatically
./scripts/update-snapshot.sh

# To keep old snapshots instead of deleting:
./scripts/update-snapshot.sh --keep-old

# To force re-import even if the date is already in the DB
# (use when a newer scan was published for the same day):
./scripts/update-snapshot.sh --force
```

The script:
1. Checks the latest published date at the RCC public URL
2. Compares it against what's in the DB — exits if already up to date
3. Downloads new files (`download-scans.sh`)
4. Imports into ClickHouse (`docker-import.sh`)
5. Deletes the old snapshot from all DB tables + cleans disk

**Enable automatic daily updates (run once after `docker compose up -d`):**
```bash
./scripts/setup-cron.sh
```

This installs 3 cron jobs — at **5am**, **noon**, and **9pm** — so at least one will catch any new scan published that day. The script is idempotent: if nothing is new, it exits silently.

Logs are written to:
- `logs/auto-update.log` — full output from every run
- `logs/cron.log` — cron stdout/stderr

**Check or remove:**
```bash
crontab -l                         # see installed jobs
./scripts/setup-cron.sh --remove   # remove all auto-update jobs
```

---

### Updating Scans

**1. Run new scan on RCC**
```bash
cd ~/storage-tracker/scanner/scripts
./scan_cil_parallel.sh
```

**2. Download new files to local machine**
```bash
./scanner/scripts/download-scans.sh
```

**3. Upload to cloud server**
```bash
rsync -avz ./cil_scans/ ubuntu@<VM_IP>:~/storage-tracker/cil_scans/
```

**4. Import on server**
```bash
ssh ubuntu@<VM_IP>
cd ~/storage-tracker
./scripts/docker-import.sh
```

---

## Project Structure

```
storage-tracker/
├── scanner/              # Rust filesystem scanner
│   ├── src/             # Scanner source code
│   └── scripts/         # Slurm and pipeline scripts
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

# Restart ClickHouse
docker compose restart clickhouse
```

**Port already in use:**
```bash
# Find process using the port
lsof -i :3000 :8000 :9000

# Kill the process or change ports in docker-compose.yml
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

---

## Additional Documentation

- **scanner/README.md** - Scanner performance tuning
- **clickhouse/scripts/README.md** - Import script options

---

## Quick Reference

```bash
# 1. On RCC: Scan (runs automatically via daily_pipeline.sh)
cd ~/storage-tracker/scanner/scripts
./scan_cil_parallel.sh

# 2. On local machine: Download from RCC public_html
./scanner/scripts/download-scans.sh

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
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone <repo> && cd storage-tracker
docker compose up -d
# Run SQL schema files (once)
# Import scans
```

**Performance:** 50K+ files/sec scanning, <0.1s queries, 74M entries