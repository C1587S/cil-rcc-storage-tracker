# CIL RCC Console

Track 400+ TB of storage and compute resources at UChicago RCC from a single dashboard.

---

## Overview

- **Scanner** (Rust): Runs daily on RCC via Slurm, scans `/project/cil`, generates Parquet snapshots
- **Database** (ClickHouse): 72M+ entries, <0.1s queries, password-protected
- **API** (FastAPI): Query, browse, search endpoints with SQL guardrails (SELECT only, row limits)
- **Dashboard** (Next.js): Dark/light mode, responsive (mobile + desktop), GNOME Adwaita styling
- **AI Query**: Natural language to SQL, runs locally -- no data leaves the server
- **Tunnel** (Cloudflare): Exposes local server to the web over HTTPS as a systemd service

### Dashboard Tabs

| Tab | Description |
|-----|-------------|
| **Docs** | In-app documentation with interactive architecture diagram (ReactFlow) |
| **Computing** | Live CIL node usage (PCB-style rack diagram), Slurm jobs, SU/storage quotas |
| **Query Console** | Unified SQL editor -- natural language prompt, templates, or raw SQL. Results with column/row highlighting, include/exclude filters, CSV/TXT/MD export |
| **Filter Builder** | Form-based filesystem search with presets, multi-pattern matching, size range |
| **Tree Explorer** | Hierarchical filesystem browser with size bars, sorting, reference directory |
| **Voronoi** | Area-proportional treemap visualization of storage usage with drill-down navigation |

---

## Computing Monitoring

The computing panel shows the current state of CIL's RCC resources -- node usage, active Slurm jobs, and quota information -- so team members can check on things without starting a terminal session on the cluster.

### What it shows

- **Node usage** -- CPU and RAM allocation across CIL partitions on Midway2 and Midway3, displayed as a visual PCB-style rack diagram
- **Active Slurm jobs** -- running and pending jobs across all CIL partitions, with user, partition, node count, and elapsed time
- **Service unit quotas** -- current SU balance and usage from daily snapshots
- **Storage quotas** -- allocation and usage per filesystem, also from daily snapshots

### Schedule

Slurm data (node usage and active jobs) is fetched on a schedule tuned for working hours:

- **Weekdays 9 AM -- 5 PM**: every 15 minutes
- **Weekends**: every hour

Outside those windows the data is not refreshed. Quota information (SU and storage) comes from daily filesystem snapshots and updates once per day.

---

## Data Pipeline

```
RCC Filesystem (/project/cil)
    |
    | Rust scanner via Slurm (~2am daily)
    v
Parquet files in scratch (midway3)
    |
    | daily_pipeline.sh -> publish to public_html
    v
HTTP on Midway2 (public_html)
    |
    | download-scans.sh (validates with Polars, re-downloads corrupted)
    v
Local machine (cil_scans/)
    |
    | docker-import.sh / update-snapshot.sh
    v
ClickHouse (Docker volume)
    |
    | FastAPI
    v
Dashboard (Next.js) <-- Cloudflare Tunnel --> Browser
```

---

## Deployment

### Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- 4GB+ RAM, 10GB+ disk
- Cloudflare account (free) + domain for tunnel

### 1. Clone and configure

```bash
git clone <repo-url> dev-tracker-app
cd dev-tracker-app
```

Create a `.env` file in the project root:

```bash
CLICKHOUSE_PASSWORD=<strong-random-password>
ALLOWED_USERS=user1,user2,user3
```

This file is gitignored and never committed. All secrets are read from here by `docker-compose.yml`.

### 2. Start services

```bash
docker compose up -d
```

This starts ClickHouse (with password auth), the init container (creates tables on first run), the FastAPI backend, and the Next.js frontend.

### 3. Import data

Download the latest scan from RCC and import:

```bash
# Download Parquet files from RCC public_html
./scanner/scripts/download-scans.sh

# Import into ClickHouse
./scripts/docker-import.sh
```

Or use the all-in-one update script:

```bash
./scripts/update-snapshot.sh
```

### 4. Set up Cloudflare Tunnel

Install cloudflared:

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin
```

One-time setup:

```bash
cloudflared tunnel login
cloudflared tunnel create dev-tracker
cloudflared tunnel route dns dev-tracker your-domain.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: dev-tracker
credentials-file: /home/<user>/.cloudflared/<TUNNEL-ID>.json
protocol: http2

ingress:
  - hostname: your-domain.com
    path: /cil-rcc-tracker
    service: http://localhost:3000
  - service: http_status:404
```

`protocol: http2` is important -- the default QUIC (UDP) drops idle connections on residential/NAT networks. HTTP/2 uses TCP, which handles keepalives and NAT mapping much better.

Set up as a systemd user service (auto-start on boot, auto-restart on crash):

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
loginctl enable-linger $USER
```

Access: `https://your-domain.com/cil-rcc-tracker`

The app is built with `NEXT_PUBLIC_BASE_PATH=/cil-rcc-tracker` (configured in `docker-compose.yml`).

### 5. Enable automatic updates

```bash
./scripts/setup-cron.sh
```

Installs 3 cron jobs (5am, noon, 9pm) so at least one catches any new scan published that day. Idempotent -- exits silently if nothing is new.

```bash
crontab -l                         # see installed jobs
./scripts/setup-cron.sh --remove   # remove all auto-update jobs
```

Logs: `logs/auto-update.log`, `logs/cron.log`

---

## RCC Scanner Setup

### First-time setup on Midway2

```bash
ssh midway2.rcc.uchicago.edu
chmod o+x $HOME
mkdir -p $HOME/public_html
chmod o+x $HOME/public_html
```

### Daily pipeline (runs automatically)

```bash
sbatch --begin=02:00 scanner/scripts/daily_pipeline.sh
```

Resubmits itself every day. Stop with `scancel <job_id>`.

### Manual scan

```bash
cd ~/storage-tracker/scanner
module load rust
cargo build --release
cd scripts && ./scan_cil_parallel.sh
```

See [scanner/README.md](scanner/README.md) for performance tuning and scanner options.

---

## Snapshot Management

All `clickhouse-client` commands require the password. Either pass it inline or set the env var:

```bash
# Option A: use the password from .env
source .env
PASS="--password $CLICKHOUSE_PASSWORD"

# Then use $PASS in commands below
```

**List snapshots:**

```bash
docker compose exec clickhouse clickhouse-client $PASS --query \
  "SELECT snapshot_date, formatReadableQuantity(count()) as entries
   FROM filesystem.entries GROUP BY snapshot_date ORDER BY snapshot_date DESC"
```

**Manual update (download + import + delete old):**

```bash
./scripts/update-snapshot.sh             # auto-detect, import, delete old
./scripts/update-snapshot.sh --keep-old  # keep previous snapshots
./scripts/update-snapshot.sh --force     # re-import even if date matches DB
```

**Delete a specific snapshot:**

```bash
DATE="2026-03-07"
for table in entries directory_hierarchy voronoi_precomputed snapshots; do
  docker compose exec clickhouse clickhouse-client $PASS --query \
    "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date='${DATE}'"
done
docker compose exec clickhouse clickhouse-client $PASS --query \
  "OPTIMIZE TABLE filesystem.entries FINAL"
```

**Keep only the latest snapshot:**

```bash
LATEST=$(docker compose exec clickhouse clickhouse-client $PASS --query \
  "SELECT max(snapshot_date) FROM filesystem.entries" | tr -d '\r')
echo "Keeping: ${LATEST}"
for table in entries directory_hierarchy voronoi_precomputed snapshots; do
  docker compose exec clickhouse clickhouse-client $PASS --query \
    "ALTER TABLE filesystem.${table} DELETE WHERE snapshot_date != '${LATEST}'"
done
docker compose exec clickhouse clickhouse-client $PASS --query \
  "OPTIMIZE TABLE filesystem.entries FINAL"
```

**Regenerate Voronoi (if file counts show 0):**

```bash
docker compose run --rm importer python scripts/compute_voronoi_unified.py 2026-03-07 --force
```

---

## Project Structure

```
dev-tracker-app/
├── scanner/                # Rust filesystem scanner
│   ├── src/               # Scanner source code
│   └── scripts/           # Slurm pipeline, download, publish scripts
├── clickhouse/            # Database layer
│   ├── schema/            # SQL table definitions
│   ├── scripts/           # Import/processing scripts (voronoi, sizes)
│   └── config/            # ClickHouse users.xml
├── apps/
│   ├── api/               # FastAPI backend (query, browse, search)
│   └── web/               # Next.js dashboard
├── docs/                  # MDX documentation (rendered in dashboard)
├── scripts/
│   ├── docker-import.sh   # One-command import
│   ├── update-snapshot.sh # Full pipeline (download + import + cleanup)
│   └── setup-cron.sh      # Install daily cron jobs
├── cil_scans/             # Parquet files (gitignored)
├── .env                   # Secrets: passwords, allowed users (gitignored)
└── docker-compose.yml     # All-in-one deployment
```

---

## Maintenance

```bash
# View logs
docker compose logs -f

# Restart services
docker compose restart

# Rebuild after code changes
docker compose build web && docker compose up -d web  # frontend only
docker compose build && docker compose up -d          # everything

# Check database size
source .env && docker compose exec clickhouse clickhouse-client \
  --password "$CLICKHOUSE_PASSWORD" --query \
  "SELECT formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE database='filesystem'"

# Tunnel status
systemctl --user status cloudflared
journalctl --user -u cloudflared -f
```

---

## Troubleshooting

**Scanner fails on RCC:**

```bash
quota -s
df -h /project/cil
srun --partition=bigmem --time=4:00:00 --mem=16G --pty bash
```

**Import fails:**

```bash
docker compose run --rm importer python -c \
  "import polars as pl; print(pl.read_parquet('/scans/battuta/2026-03-07/part-00000.parquet').schema)"
docker compose logs clickhouse
```

**Dashboard shows "No snapshots":**

```bash
source .env
docker compose exec clickhouse clickhouse-client --password "$CLICKHOUSE_PASSWORD" --query \
  "SELECT snapshot_date, count() FROM filesystem.entries GROUP BY snapshot_date"
curl http://localhost:8000/api/snapshots
```

**Cannot connect to ClickHouse:**

```bash
docker compose ps
docker compose logs clickhouse
docker compose restart clickhouse
```

---

## Development

**Full Docker stack:**

```bash
docker compose up -d
docker compose logs -f api web
# Make changes, then:
docker compose build api web && docker compose up -d
```

**Hybrid (ClickHouse in Docker, dev servers local):**

```bash
docker compose up -d clickhouse
cd apps/api && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
cd apps/web && npm run dev
```

---

## Additional Documentation

- [scanner/README.md](scanner/README.md) -- Scanner performance tuning
- [clickhouse/scripts/README.md](clickhouse/scripts/README.md) -- Import script options
- Dashboard "Docs" tab -- interactive architecture diagram, query examples, feature guides
