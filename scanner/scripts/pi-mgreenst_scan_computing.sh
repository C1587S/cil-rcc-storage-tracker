#!/bin/bash
# =============================================================================
# pi-mgreenst_scan_computing.sh — Projection Run Monitor (v3.0.0)
#
# GCM-level granularity for dashboard visualization. Produces a JSON with
# per-scenario, per-GCM status (completed/in_progress/failed/not_started),
# file inventories, timing estimates, partition availability, user breakdown,
# and a job history log (failed, timed-out, and recently completed jobs).
#
# Usage:
#   bash pi-mgreenst_scan_computing.sh              # terminal
#   bash pi-mgreenst_scan_computing.sh --json        # json stdout
#   bash pi-mgreenst_scan_computing.sh --json --outdir /path  # json to file
#   bash pi-mgreenst_scan_computing.sh -u cadavidsanchez      # filter by user
# =============================================================================
set -o pipefail

MONITOR_VERSION="3.0.0"
ACCOUNT="pi-mgreenst"
USER_FILTER=""
OUTPUT_MODE="terminal"
OUTDIR=""
OUTPUT_ROOT="/project/cil/gcp/outputs/mortality_new-socioeconomics/impacts-darwin"
SCAN_PARTITIONS="caslake,amd,amd-hm"
HISTORY_HOURS=24

while [[ $# -gt 0 ]]; do
    case $1 in
        -a|--account)     ACCOUNT="$2";          shift 2 ;;
        -u|--user)        USER_FILTER="$2";      shift 2 ;;
        --output-root)    OUTPUT_ROOT="$2";      shift 2 ;;
        --json)           OUTPUT_MODE="json";    shift ;;
        --outdir)         OUTDIR="$2"; OUTPUT_MODE="json"; shift 2 ;;
        --partitions)     SCAN_PARTITIONS="$2";  shift 2 ;;
        --history-hours)  HISTORY_HOURS="$2";    shift 2 ;;
        *)                shift ;;
    esac
done

TMPDIR_MON=$(mktemp -d)
trap "rm -rf $TMPDIR_MON" EXIT

# =========================================================================
# Collect all raw data into temp files, then use Python for assembly
# =========================================================================

# 1. Partition info
for part in $(echo "$SCAN_PARTITIONS" | tr ',' ' '); do
    sinfo -p "$part" -N -h -o "%n|%T|%C|%e|%m" 2>/dev/null >> "$TMPDIR_MON/partinfo_${part}"
done

# 2. SLURM active jobs
if [[ -n "$USER_FILTER" ]]; then
    squeue -u "$USER_FILTER" -h -o "%i|%u|%j|%T|%P|%R|%C|%m|%M|%l|%L|%N" 2>/dev/null > "$TMPDIR_MON/squeue_raw"
else
    squeue -A "$ACCOUNT" -h -o "%i|%u|%j|%T|%P|%R|%C|%m|%M|%l|%L|%N" 2>/dev/null > "$TMPDIR_MON/squeue_raw"
fi

# 3. Job history from sacct (last N hours — captures failures, timeouts, OOM, completions)
SACCT_START=$(date -d "${HISTORY_HOURS} hours ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v-${HISTORY_HOURS}H +%Y-%m-%dT%H:%M:%S)
if [[ -n "$USER_FILTER" ]]; then
    sacct -u "$USER_FILTER" -S "$SACCT_START" --noheader --parsable2 \
        -o JobID,JobName,User,State,ExitCode,Elapsed,Start,End,Partition,AllocCPUS,MaxRSS,NodeList \
        2>/dev/null > "$TMPDIR_MON/sacct_raw"
else
    sacct -A "$ACCOUNT" -S "$SACCT_START" --noheader --parsable2 \
        -o JobID,JobName,User,State,ExitCode,Elapsed,Start,End,Partition,AllocCPUS,MaxRSS,NodeList \
        2>/dev/null > "$TMPDIR_MON/sacct_raw"
fi

# 4. Output file inventory with timestamps and sizes
for rtype in median montecarlo single; do
    base="${OUTPUT_ROOT}/${rtype}"
    [[ ! -d "$base" ]] && continue
    find "$base" -name "*.nc4" -o -name "*.csv" -o -name "*.yml" -o -name "*.txt" 2>/dev/null | while read -r fpath; do
        stat_out=$(stat --printf="%s|%Y" "$fpath" 2>/dev/null || stat -f "%z|%m" "$fpath" 2>/dev/null)
        echo "${rtype}|${fpath#${OUTPUT_ROOT}/}|${stat_out}"
    done >> "$TMPDIR_MON/file_inventory"
done

# =========================================================================
# Python does the heavy lifting: parse, structure, output
# =========================================================================
python3 << 'PYEOF' - "$TMPDIR_MON" "$OUTPUT_ROOT" "$SCAN_PARTITIONS" "$ACCOUNT" "$USER_FILTER" "$OUTPUT_MODE" "$OUTDIR" "$MONITOR_VERSION" "$HISTORY_HOURS"

import sys, os, json, re, glob
from datetime import datetime, timezone
from collections import defaultdict

tmpdir = sys.argv[1]
output_root = sys.argv[2]
scan_partitions = sys.argv[3].split(",")
account = sys.argv[4]
user_filter = sys.argv[5] or "all"
output_mode = sys.argv[6]
outdir = sys.argv[7]
version = sys.argv[8]
history_hours = int(sys.argv[9]) if sys.argv[9].isdigit() else 24

ts_start = datetime.now()

# Known GCM lists (extracted from typical RCP runs)
GCMS_RCP45 = 32
GCMS_RCP85 = 33
MC_BATCHES = 15

def fmt_duration(secs):
    if secs is None or secs < 0:
        return "n/a"
    secs = int(secs)
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs//60}m {secs%60}s"
    return f"{secs//3600}h {secs%3600//60}m"

def mem_to_gb(mem_str):
    if not mem_str:
        return 0
    m = re.match(r'(\d+)', mem_str)
    if not m:
        return 0
    val = int(m.group(1))
    if 'G' in mem_str.upper():
        return val
    if 'M' in mem_str.upper():
        return val // 1024
    if 'T' in mem_str.upper():
        return val * 1024
    return val // 1024  # default MB

# =========================================================================
# 1. Parse partitions
# =========================================================================
partitions = []
for part in scan_partitions:
    pfile = os.path.join(tmpdir, f"partinfo_{part}")
    if not os.path.exists(pfile):
        continue
    nodes_total = idle = mixed = alloc = down = 0
    cpu_alloc = cpu_total = mem_used = mem_total = 0
    with open(pfile) as f:
        for line in f:
            fields = line.strip().split("|")
            if len(fields) < 5:
                continue
            node, state, cpuinfo, freemem, totmem = fields[:5]
            nodes_total += 1
            parts = cpuinfo.split("/")
            a_cpu = int(parts[0]) if parts[0].isdigit() else 0
            t_cpu = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
            t_mem = int(totmem) // 1024 if totmem.isdigit() else 0
            f_mem = int(freemem) // 1024 if freemem.isdigit() else 0
            u_mem = t_mem - f_mem

            cpu_alloc += a_cpu
            cpu_total += t_cpu
            mem_used += u_mem
            mem_total += t_mem

            if state in ("idle",):
                idle += 1
            elif state in ("mixed", "mix"):
                mixed += 1
            elif state in ("allocated", "alloc"):
                alloc += 1
            elif state.startswith("down") or state.startswith("drain"):
                down += 1

    partitions.append({
        "name": part,
        "nodes": {"total": nodes_total, "idle": idle, "mixed": mixed, "allocated": alloc, "down": down},
        "cpus": {
            "total": cpu_total, "allocated": cpu_alloc, "free": cpu_total - cpu_alloc,
            "pct": round(cpu_alloc * 100 / cpu_total, 1) if cpu_total > 0 else 0
        },
        "mem_gb": {
            "total": mem_total, "used": mem_used, "free": mem_total - mem_used,
            "pct": round(mem_used * 100 / mem_total, 1) if mem_total > 0 else 0
        }
    })

# =========================================================================
# 2. Parse jobs
# =========================================================================
def classify_job(name):
    name_lower = name.lower()
    run_type = "other"
    if "median" in name_lower:
        run_type = "median"
    elif name_lower.startswith("mc-"):
        run_type = "montecarlo"
    elif "single" in name_lower:
        run_type = "single"

    ssp = rcp = iam = ""
    if "ssp2" in name_lower: ssp = "SSP2"
    elif "ssp3" in name_lower: ssp = "SSP3"
    if "85" in name_lower: rcp = "rcp85"
    elif "45" in name_lower: rcp = "rcp45"
    if "high" in name_lower: iam = "high"
    elif "low" in name_lower: iam = "low"

    scenario = "unknown"
    if ssp and rcp and iam:
        scenario = f"{ssp}-{rcp}-{iam}"
    elif rcp:
        scenario = rcp

    return run_type, scenario

users = defaultdict(lambda: {"running": 0, "pending": 0, "cpus": 0, "mem_gb": 0,
                               "longest_elapsed": "", "scenarios": set()})
jobs_by_scenario = defaultdict(lambda: {"running": 0, "pending": 0})
total_running = total_pending = total_cpus = total_mem_gb = 0
longest_elapsed = ""
partitions_used = set()
all_jobs = []

squeue_file = os.path.join(tmpdir, "squeue_raw")
if os.path.exists(squeue_file):
    with open(squeue_file) as f:
        for line in f:
            fields = line.strip().split("|")
            if len(fields) < 12:
                continue
            jobid, user, name, state, partition = fields[:5]
            cpus = int(fields[6]) if fields[6].isdigit() else 0
            mem = fields[7]
            elapsed = fields[8]

            run_type, scenario = classify_job(name)
            key = f"{run_type}/{scenario}"

            job_entry = {
                "job_id": jobid, "user": user, "name": name, "state": state,
                "partition": partition, "cpus": cpus, "mem": mem, "elapsed": elapsed,
                "run_type": run_type, "scenario": scenario
            }
            all_jobs.append(job_entry)

            u = users[user]
            if state == "RUNNING":
                total_running += 1
                total_cpus += cpus
                total_mem_gb += mem_to_gb(mem)
                partitions_used.add(partition)
                u["running"] += 1
                u["cpus"] += cpus
                u["mem_gb"] += mem_to_gb(mem)
                if elapsed > u["longest_elapsed"]:
                    u["longest_elapsed"] = elapsed
                if elapsed > longest_elapsed:
                    longest_elapsed = elapsed
                jobs_by_scenario[key]["running"] += 1
            elif state == "PENDING":
                total_pending += 1
                u["pending"] += 1
                jobs_by_scenario[key]["pending"] += 1

            u["scenarios"].add(key)

# =========================================================================
# 2b. Parse job history from sacct (failures, completions, timeouts)
# =========================================================================
FAILURE_STATES = {"FAILED", "TIMEOUT", "OUT_OF_MEMORY", "CANCELLED", "NODE_FAIL", "PREEMPTED"}
SUCCESS_STATES = {"COMPLETED"}

job_history = []       # all finished jobs (last N hours)
failed_jobs = []       # only failures
completed_jobs = []    # only successes
failed_scenarios = defaultdict(int)  # scenario -> failure count

sacct_file = os.path.join(tmpdir, "sacct_raw")
if os.path.exists(sacct_file):
    with open(sacct_file) as f:
        for line in f:
            fields = line.strip().split("|")
            if len(fields) < 12:
                continue
            jobid, name, user, state, exitcode, elapsed, start, end, partition, cpus, maxrss, nodelist = fields[:12]

            # Skip sub-steps (batch, extern) — only keep main job entries
            if "." in jobid:
                continue

            # Normalize state (strip trailing qualifiers like "CANCELLED by 12345")
            base_state = state.split()[0] if state else ""

            run_type, scenario = classify_job(name)
            key = f"{run_type}/{scenario}"

            entry = {
                "job_id": jobid,
                "name": name,
                "user": user,
                "state": base_state,
                "exit_code": exitcode,
                "elapsed": elapsed,
                "start": start,
                "end": end,
                "partition": partition,
                "cpus": int(cpus) if cpus.isdigit() else 0,
                "max_rss": maxrss,
                "node": nodelist,
                "run_type": run_type,
                "scenario": scenario
            }

            if base_state in FAILURE_STATES:
                failed_jobs.append(entry)
                failed_scenarios[key] += 1
            elif base_state in SUCCESS_STATES:
                completed_jobs.append(entry)

            if base_state in FAILURE_STATES | SUCCESS_STATES:
                job_history.append(entry)

# Sort by end time (most recent first)
failed_jobs.sort(key=lambda j: j["end"], reverse=True)
completed_jobs.sort(key=lambda j: j["end"], reverse=True)

# =========================================================================
# 3. Parse file inventory and build GCM-level data
# =========================================================================
# Structure: {run_type: {scenario: {gcm: {files: [...], completed_at: epoch}}}}
output_data = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: {"files": [], "completed_at": None})))
all_scenario_keys = set()

inv_file = os.path.join(tmpdir, "file_inventory")
if os.path.exists(inv_file):
    with open(inv_file) as f:
        for line in f:
            parts = line.strip().split("|")
            if len(parts) < 3:
                continue
            run_type = parts[0]
            rel_path = parts[1]
            size_bytes = int(parts[2]) if parts[2].isdigit() else 0
            mtime = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0

            # Parse: rcp45/CCSM4/high/SSP2/filename
            path_parts = rel_path.split("/")
            if len(path_parts) < 5:
                continue
            rcp, gcm, iam, ssp = path_parts[:4]
            filename = path_parts[-1]
            scenario = f"{ssp}-{rcp}-{iam}"
            key = f"{run_type}/{scenario}"
            all_scenario_keys.add(key)

            gcm_data = output_data[run_type][scenario][gcm]
            gcm_data["files"].append({
                "name": filename,
                "size_mb": round(size_bytes / (1024 * 1024), 1),
                "modified": mtime
            })
            if "combined.nc4" in filename:
                if gcm_data["completed_at"] is None or mtime > gcm_data["completed_at"]:
                    gcm_data["completed_at"] = mtime

# Also add scenario keys from jobs
for k in jobs_by_scenario:
    all_scenario_keys.add(k)

# =========================================================================
# 4. Build scenario summaries with GCM grid
# =========================================================================
# Discover all known GCMs from output directories
all_known_gcms = set()
for rtype in output_data:
    for scen in output_data[rtype]:
        for gcm in output_data[rtype][scen]:
            all_known_gcms.add(gcm)

scenarios_out = []
for key in sorted(all_scenario_keys):
    parts = key.split("/")
    run_type = parts[0]
    scenario = parts[1] if len(parts) > 1 else "unknown"

    # Expected count
    ngcms = GCMS_RCP85 if "rcp85" in scenario else GCMS_RCP45
    if run_type == "montecarlo":
        expected = ngcms * MC_BATCHES
    elif run_type == "median":
        expected = ngcms
    else:
        expected = 1

    # GCM-level data
    gcm_map = output_data.get(run_type, {}).get(scenario, {})
    completed_gcms = [g for g, d in gcm_map.items() if d["completed_at"] is not None]
    completed_count = len(completed_gcms)
    remaining = expected - completed_count

    # Per-GCM grid
    gcm_grid = []
    has_running = jobs_by_scenario.get(key, {}).get("running", 0) > 0

    scenario_failures = failed_scenarios.get(key, 0)

    for gcm_name in sorted(gcm_map.keys()):
        gdata = gcm_map[gcm_name]
        is_complete = gdata["completed_at"] is not None
        total_size = sum(f["size_mb"] for f in gdata["files"])
        completed_ts = None
        if gdata["completed_at"]:
            try:
                completed_ts = datetime.fromtimestamp(gdata["completed_at"]).strftime("%Y-%m-%dT%H:%M:%S")
            except:
                pass

        # Detect partial/failed: has output files but no combined.nc4 and no running jobs
        has_files = len(gdata["files"]) > 0
        is_partial = has_files and not is_complete and not has_running

        if is_complete:
            status = "completed"
        elif has_running:
            status = "in_progress"
        elif is_partial:
            status = "failed"  # has output but no combined.nc4 and nothing running
        else:
            status = "not_started"

        gcm_grid.append({
            "gcm": gcm_name,
            "status": status,
            "completed_at": completed_ts,
            "files": gdata["files"],
            "file_count": len(gdata["files"]),
            "total_size_mb": round(total_size, 1)
        })

    # Timing estimates
    timestamps = sorted([d["completed_at"] for d in gcm_map.values() if d["completed_at"] is not None])
    first_completed = None
    last_completed = None
    rate_per_hour = None
    eta_seconds = None
    eta_display = "n/a"

    if len(timestamps) >= 1:
        first_completed = datetime.fromtimestamp(timestamps[0]).strftime("%Y-%m-%dT%H:%M:%S")
        last_completed = datetime.fromtimestamp(timestamps[-1]).strftime("%Y-%m-%dT%H:%M:%S")

    if len(timestamps) >= 2:
        span = timestamps[-1] - timestamps[0]
        if span > 0:
            rate_per_hour = round((len(timestamps) - 1) * 3600 / span, 2)
            if remaining > 0 and rate_per_hour > 0:
                eta_seconds = int(remaining * 3600 / rate_per_hour)
                eta_display = fmt_duration(eta_seconds)
            else:
                eta_seconds = 0
                eta_display = "done"
    elif len(timestamps) == 1:
        eta_display = "estimating..."

    running_jobs = jobs_by_scenario.get(key, {}).get("running", 0)
    pending_jobs = jobs_by_scenario.get(key, {}).get("pending", 0)
    pct = round(completed_count * 100 / expected, 1) if expected > 0 else 0

    # Count statuses from GCM grid
    failed_gcms = [g for g in gcm_grid if g["status"] == "failed"]

    scenarios_out.append({
        "run_type": run_type,
        "scenario": scenario,
        "jobs": {
            "running": running_jobs,
            "pending": pending_jobs,
            "failed_recent": scenario_failures
        },
        "progress": {
            "completed": completed_count,
            "expected": expected,
            "remaining": remaining,
            "pct": pct,
            "failed_gcms": len(failed_gcms)
        },
        "timing": {
            "first_completed": first_completed,
            "last_completed": last_completed,
            "rate_per_hour": rate_per_hour,
            "eta_seconds": eta_seconds,
            "eta_display": eta_display
        },
        "gcms": gcm_grid
    })

# =========================================================================
# 5. Users
# =========================================================================
users_out = []
for uname in sorted(users, key=lambda u: users[u]["running"], reverse=True):
    u = users[uname]
    users_out.append({
        "user": uname,
        "running": u["running"],
        "pending": u["pending"],
        "cpus": u["cpus"],
        "mem_gb": u["mem_gb"],
        "longest_elapsed": u["longest_elapsed"],
        "scenarios": sorted(u["scenarios"])
    })

# =========================================================================
# 6. Output totals
# =========================================================================
total_nc4 = 0
total_size_bytes = 0
if os.path.exists(inv_file):
    with open(inv_file) as f:
        for line in f:
            parts = line.strip().split("|")
            if len(parts) >= 3 and parts[1].endswith(".nc4"):
                total_nc4 += 1
                total_size_bytes += int(parts[2]) if parts[2].isdigit() else 0

total_size_display = f"{total_size_bytes / (1024**3):.1f}G" if total_size_bytes > 1024**3 else f"{total_size_bytes / (1024**2):.0f}M"

# =========================================================================
# 7. Assemble
# =========================================================================
scan_duration = round((datetime.now() - ts_start).total_seconds(), 1)

report = {
    "meta": {
        "timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S%z"),
        "account": account,
        "user_filter": user_filter,
        "output_root": output_root,
        "scan_duration_sec": scan_duration,
        "version": version,
        "history_hours": history_hours
    },
    "summary": {
        "total_running": total_running,
        "total_pending": total_pending,
        "total_cpus": total_cpus,
        "total_mem_gb": total_mem_gb,
        "partitions_in_use": sorted(partitions_used),
        "longest_elapsed": longest_elapsed or "n/a",
        "total_nc4_files": total_nc4,
        "total_output_size": total_size_display,
        "total_failed_recent": len(failed_jobs),
        "total_completed_recent": len(completed_jobs)
    },
    "partitions": partitions,
    "users": users_out,
    "scenarios": scenarios_out,
    "job_history": {
        "period_hours": history_hours,
        "failed": failed_jobs[:50],
        "recently_completed": completed_jobs[:50]
    }
}

# =========================================================================
# 8. Output
# =========================================================================
if output_mode == "json":
    if outdir:
        os.makedirs(outdir, exist_ok=True)
        fname = f"projection_status_{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        path = os.path.join(outdir, fname)
        with open(path, "w") as f:
            json.dump(report, f, indent=2)
        print(path)
    else:
        print(json.dumps(report, indent=2))
    sys.exit(0)

# Terminal output — neutral palette (no red/green political colors)
R = "\033[0m"; B = "\033[1m"; DIM = "\033[2m"
WHT = "\033[1;37m"; CYN = "\033[0;36m"; BLU = "\033[0;34m"
MAG = "\033[0;35m"; ORG = "\033[38;5;208m"; SKY = "\033[38;5;75m"
WARN = "\033[38;5;203m"  # soft coral for warnings/failures

# Status markers: * done, ~ running, x failed, . pending
S_DONE = f"{CYN}*{R}"
S_RUN  = f"{SKY}~{R}"
S_FAIL = f"{WARN}x{R}"
S_PEND = f"{DIM}.{R}"

def pbar(cur, tot, width=25):
    if tot <= 0:
        return f"[{' '*width}] N/A"
    pct = cur * 100 // tot
    fill = cur * width // tot
    empty = width - fill
    c = DIM if pct == 0 else (ORG if pct < 50 else (SKY if pct < 90 else CYN))
    bar = c + "=" * fill + DIM + "-" * empty + R
    return f"[{bar}] {c}{pct:3d}%{R} ({cur}/{tot})"

print()
print(f"{B}{BLU}Projection Monitor{R}  {DIM}(v{version}){R}")
print(f"  Account: {CYN}{account}{R}   User: {CYN}{user_filter}{R}")
print(f"  Output:  {DIM}{output_root}{R}")
print(f"  {DIM}{ts_start.strftime('%Y-%m-%d %H:%M:%S')}   scan took {scan_duration}s{R}")
print()
print(f"  {DIM}Legend:  {S_DONE} done   {S_RUN} running   {S_FAIL} failed   {S_PEND} pending{R}")

# Partitions
print(f"\n{B}{MAG}PARTITIONS{R}")
print(f"{DIM}----------------------------------------------------------------------{R}")
print(f"  {B}{'Partition':<12} {'Nodes':>6} {'Idle':>6} {'Mixed':>6} {'Down':>6} {'CPU%':>6} {'Mem%':>6}{R}")
for p in partitions:
    print(f"  {p['name']:<12} {p['nodes']['total']:>6} {p['nodes']['idle']:>6} "
          f"{p['nodes']['mixed']:>6} {p['nodes']['down']:>6} "
          f"{p['cpus']['pct']:>5.0f}% {p['mem_gb']['pct']:>5.0f}%")

# Jobs
print(f"\n{B}{CYN}JOBS{R}")
print(f"{DIM}----------------------------------------------------------------------{R}")
print(f"  Running: {SKY}{total_running}{R}   Pending: {ORG}{total_pending}{R}   "
      f"CPUs: {WHT}{total_cpus}{R}   Mem: {WHT}{total_mem_gb}GB{R}")
if longest_elapsed:
    print(f"  Longest running: {WHT}{longest_elapsed}{R}")

# Users
print(f"\n{B}{CYN}USERS{R}")
print(f"{DIM}----------------------------------------------------------------------{R}")
print(f"  {B}{'User':<18} {'Run':>5} {'Pend':>5} {'CPUs':>5} {'Mem(GB)':>8} {'Longest':>10}{R}")
for u in users_out:
    print(f"  {u['user']:<18} {u['running']:>5} {u['pending']:>5} "
          f"{u['cpus']:>5} {u['mem_gb']:>8} {u['longest_elapsed']:>10}")
    print(f"  {DIM}  {', '.join(u['scenarios'])}{R}")

# Scenarios
print(f"\n{B}{CYN}SCENARIO PROGRESS{R}")
print(f"{DIM}----------------------------------------------------------------------{R}")
for s in scenarios_out:
    p = s["progress"]
    t = s["timing"]
    print(f"\n  {B}{WHT}{s['run_type']} / {s['scenario']}{R}")
    print(f"  {pbar(p['completed'], p['expected'])}")
    parts = []
    parts.append(f"Done: {CYN}{p['completed']}{R}")
    parts.append(f"Running: {SKY}{s['jobs']['running']}{R}")
    parts.append(f"Pending: {ORG}{s['jobs']['pending']}{R}")
    parts.append(f"Remaining: {p['remaining']}")
    parts.append(f"{DIM}Expected: {p['expected']}{R}")
    if p["failed_gcms"] > 0:
        parts.append(f"{WARN}Failed: {p['failed_gcms']}{R}")
    if s["jobs"]["failed_recent"] > 0:
        parts.append(f"{WARN}Job failures (24h): {s['jobs']['failed_recent']}{R}")
    print(f"  {'  '.join(parts)}")
    if t["rate_per_hour"] is not None:
        print(f"  Rate: {WHT}{t['rate_per_hour']}/hr{R}   ETA: {WHT}{t['eta_display']}{R}")
    elif p["completed"] > 0:
        print(f"  {DIM}Rate: estimating (need 2+ completions){R}")

    # GCM grid — compact visual using status markers
    if s["gcms"]:
        grid_chars = []
        for g in sorted(s["gcms"], key=lambda g: g["gcm"]):
            if g["status"] == "completed":   grid_chars.append(S_DONE)
            elif g["status"] == "in_progress": grid_chars.append(S_RUN)
            elif g["status"] == "failed":    grid_chars.append(S_FAIL)
            else:                            grid_chars.append(S_PEND)
        print(f"  GCMs: {''.join(grid_chars)}")
        done = [g["gcm"] for g in s["gcms"] if g["status"] == "completed"]
        fail = [g["gcm"] for g in s["gcms"] if g["status"] == "failed"]
        if done:
            print(f"  {DIM}  done: {', '.join(sorted(done))}{R}")
        if fail:
            print(f"  {WARN}  failed: {', '.join(sorted(fail))}{R}")

# Job history
if failed_jobs:
    print(f"\n{B}{WARN}FAILED JOBS (last {history_hours}h){R}")
    print(f"{DIM}----------------------------------------------------------------------{R}")
    print(f"  {B}{'JobID':<12} {'Name':<30} {'User':<14} {'State':<12} {'Exit':<8} {'Elapsed':<10}{R}")
    for j in failed_jobs[:15]:
        print(f"  {j['job_id']:<12} {j['name'][:29]:<30} {j['user']:<14} "
              f"{WARN}{j['state']:<12}{R} {j['exit_code']:<8} {j['elapsed']:<10}")

if completed_jobs:
    print(f"\n{B}{CYN}RECENTLY COMPLETED (last {history_hours}h){R}")
    print(f"{DIM}----------------------------------------------------------------------{R}")
    print(f"  {B}{'JobID':<12} {'Name':<30} {'User':<14} {'Elapsed':<10} {'End':<20}{R}")
    for j in completed_jobs[:10]:
        print(f"  {j['job_id']:<12} {j['name'][:29]:<30} {j['user']:<14} "
              f"{j['elapsed']:<10} {DIM}{j['end']}{R}")

# Output
print(f"\n{B}{CYN}OUTPUT{R}")
print(f"{DIM}----------------------------------------------------------------------{R}")
print(f"  NC4 files: {WHT}{total_nc4}{R}   Size: {WHT}{total_size_display}{R}")
print(f"  Failed (24h): {WARN if failed_jobs else DIM}{len(failed_jobs)}{R}   "
      f"Completed (24h): {CYN}{len(completed_jobs)}{R}")

print(f"\n{DIM}{ts_start.strftime('%Y-%m-%d %H:%M:%S')}   Account: {account}{R}")
print()

PYEOF