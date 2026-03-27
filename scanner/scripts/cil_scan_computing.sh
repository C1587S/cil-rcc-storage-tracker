#!/bin/bash
# =============================================================================
# cil_scan.sh — CIL Compute Account Scanner
# Works on Midway2 and Midway3 (auto-detects cluster from hostname).
#
# Modes:
#   Terminal (default):  bash cil_scan.sh
#   JSON to stdout:      bash cil_scan.sh --json
#   JSON to file:        bash cil_scan.sh --json --outdir /path/to/dir
#
# Options:
#   -a, --account NAME       Account name (default: cil, or $CIL_ACCOUNT)
#   --json                   Output JSON instead of terminal report
#   --outdir DIR             Write JSON file to DIR (implies --json)
#   --partitions P1,P2       Override private partition list
#   --debug                  Print raw command output to stderr
# =============================================================================
set -o pipefail

SCAN_VERSION="1.0.0"
ACCOUNT="${CIL_ACCOUNT:-cil}"
OUTPUT_MODE="terminal"   # terminal | json
OUTDIR=""
DEBUG=0
PRIVATE_PARTITIONS_OVERRIDE=""

# Parse CLI
while [[ $# -gt 0 ]]; do
    case $1 in
        -a|--account)    ACCOUNT="$2";                    shift 2 ;;
        --json)          OUTPUT_MODE="json";              shift   ;;
        --outdir)        OUTDIR="$2"; OUTPUT_MODE="json"; shift 2 ;;
        --partitions)    PRIVATE_PARTITIONS_OVERRIDE="$2"; shift 2 ;;
        --debug)         DEBUG=1;                          shift   ;;
        *)               shift ;;
    esac
done

# Helpers
decho()    { [[ "$DEBUG" -eq 1 ]] && echo -e "[DEBUG] $*" >&2; }
safe_run() { "$@" 2>/dev/null || echo ""; }
now_iso()  { date '+%Y-%m-%dT%H:%M:%S%z' | sed 's/\([+-][0-9][0-9]\)\([0-9][0-9]\)$/\1:\2/'; }
ts_start=$(date +%s%N)

# JSON helpers — these build up valid JSON strings safely
json_str() { printf '"%s"' "$(echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g')"; }
json_num() { if [[ -n "$1" && "$1" != "null" ]]; then printf '%s' "$1"; else printf 'null'; fi; }
json_int() { if [[ -n "$1" && "$1" != "null" ]]; then printf '%d' "$1" 2>/dev/null || printf 'null'; else printf 'null'; fi; }

# Extract first number from text matching a grep pattern
extract_su() { echo "$1" | grep -iE "$2" | grep -oE '[0-9,]+\.?[0-9]*' | head -1 | tr -d ','; }

# Parse SLURM memory string (e.g. "200G", "16384M", "100000") to GB (float)
mem_to_gb() {
    local raw="$1"
    [[ -z "$raw" ]] && echo "0" && return
    if [[ "$raw" =~ ^([0-9.]+)[Gg] ]]; then
        echo "${BASH_REMATCH[1]}"
    elif [[ "$raw" =~ ^([0-9.]+)[Mm] ]]; then
        awk "BEGIN{printf \"%.1f\", ${BASH_REMATCH[1]}/1024}"
    elif [[ "$raw" =~ ^([0-9.]+)[Tt] ]]; then
        awk "BEGIN{printf \"%.1f\", ${BASH_REMATCH[1]}*1024}"
    elif [[ "$raw" =~ ^([0-9]+)$ ]]; then
        # Default unit in SLURM is MB
        awk "BEGIN{printf \"%.1f\", ${BASH_REMATCH[1]}/1024}"
    else
        echo "0"
    fi
}

# Detect cluster
HOSTNAME_SHORT=$(hostname -s 2>/dev/null || hostname)

if echo "$HOSTNAME_SHORT" | grep -qi 'midway3'; then
    CLUSTER="midway3"
    PRIVATE_PARTITIONS="${PRIVATE_PARTITIONS_OVERRIDE:-cil}"
elif echo "$HOSTNAME_SHORT" | grep -qi 'midway2'; then
    CLUSTER="midway2"
    PRIVATE_PARTITIONS="${PRIVATE_PARTITIONS_OVERRIDE:-}"
else
    CLUSTER="unknown"
    PRIVATE_PARTITIONS="${PRIVATE_PARTITIONS_OVERRIDE:-}"
fi

ERRORS_JSON="[]"
add_error() {
    local cmd="$1" err="$2" raw="$3"
    raw=$(echo "$raw" | head -c 500 | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/$/\\n/' | tr -d '\n')
    ERRORS_JSON=$(echo "$ERRORS_JSON" | sed "s/\]$/,{\"command\":\"$cmd\",\"error\":\"$err\",\"raw_output\":\"$raw\"}]/")
    # Fix for first entry (empty array)
    ERRORS_JSON=$(echo "$ERRORS_JSON" | sed 's/\[,/[/')
}

# =============================================================================
# COLLECT: Service Units
# Midway3: rcchelp usage -a ACCOUNT (space-separated table)
# Midway2: rcchelp usage -a fails (ambiguous), use --account instead
#          Balance output uses pipe-delimited table
# =============================================================================
decho "Collecting service units..."

BALANCE_RAW=$(safe_run rcchelp balance -a "$ACCOUNT")
ALLOC_RAW=$(safe_run rcchelp allocations -a "$ACCOUNT")

# Try -a first, fall back to --account (Midway2 needs --account)
USAGE_RAW=$(safe_run rcchelp usage -a "$ACCOUNT" 2>/dev/null)
if [[ -z "$USAGE_RAW" ]] || echo "$USAGE_RAW" | grep -qi 'ambiguous\|error\|unrecognized'; then
    USAGE_RAW=$(safe_run rcchelp usage --account "$ACCOUNT")
fi
# Midway2 fallback: try accounts command which may have more data
if [[ -z "$USAGE_RAW" ]] || ! echo "$USAGE_RAW" | grep -qiE 'Partition|Usage|Charge'; then
    USAGE_RAW=$(safe_run accounts usage --account "$ACCOUNT" 2>/dev/null)
fi

USAGE_BYUSER_RAW=$(safe_run rcchelp usage -a "$ACCOUNT" -byuser 2>/dev/null)
if [[ -z "$USAGE_BYUSER_RAW" ]] || echo "$USAGE_BYUSER_RAW" | grep -qi 'ambiguous\|error\|unrecognized'; then
    USAGE_BYUSER_RAW=$(safe_run rcchelp usage --account "$ACCOUNT" --byuser)
fi
# Midway2 fallback: accounts command with --byuser
if echo "$USAGE_BYUSER_RAW" | grep -q '|'; then
    # Pipe format with only 1 user row = rcchelp only shows current user
    user_rows=$(echo "$USAGE_BYUSER_RAW" | grep '|' | grep -vE '^\+|Account|User|Charge' | wc -l)
    if [[ "$user_rows" -le 1 ]]; then
        alt=$(safe_run accounts usage --account "$ACCOUNT" --byuser 2>/dev/null)
        [[ -n "$alt" ]] && USAGE_BYUSER_RAW="$alt"
    fi
fi

USAGE_BYPART_RAW=$(safe_run rcchelp usage -a "$ACCOUNT" -bypartition 2>/dev/null)
if [[ -z "$USAGE_BYPART_RAW" ]] || echo "$USAGE_BYPART_RAW" | grep -qi 'ambiguous\|error\|unrecognized'; then
    USAGE_BYPART_RAW=$(safe_run rcchelp usage --account "$ACCOUNT" --bypartition 2>/dev/null)
fi
if [[ -z "$USAGE_BYPART_RAW" ]] || ! echo "$USAGE_BYPART_RAW" | grep -qiE 'Partition|Usage|Charge'; then
    USAGE_BYPART_RAW=$(safe_run accounts usage --account "$ACCOUNT" --bypartition 2>/dev/null)
fi

decho "balance raw:\n$BALANCE_RAW"
decho "allocations raw:\n$ALLOC_RAW"
decho "usage raw:\n$USAGE_RAW"
decho "usage byuser raw:\n$USAGE_BYUSER_RAW"
decho "usage bypartition raw:\n$USAGE_BYPART_RAW"

# Parse balance — two formats:
#   Midway3 (spaces): "cil  800000  416766  383233"
#   Midway2 (pipes):  "| cil | 800000 | 416766.47 | 383233.53 |"
BALANCE_LINE=$(echo "$BALANCE_RAW" | grep -E "${ACCOUNT}" | grep -vE '^(\+|-|Account|Note)' | head -1)
if [[ -n "$BALANCE_LINE" ]]; then
    if echo "$BALANCE_LINE" | grep -q '|'; then
        # Pipe format — extract numbers between pipes
        ALLOC_SU=$(echo "$BALANCE_LINE" | awk -F'|' '{gsub(/[[:space:]]/,"",$3); print $3}')
        USED_SU=$(echo "$BALANCE_LINE" | awk -F'|' '{gsub(/[[:space:]]/,"",$4); print $4}')
        BALANCE_SU=$(echo "$BALANCE_LINE" | awk -F'|' '{gsub(/[[:space:]]/,"",$5); print $5}')
    else
        # Space format
        ALLOC_SU=$(echo "$BALANCE_LINE" | awk '{print $2}')
        USED_SU=$(echo "$BALANCE_LINE" | awk '{print $3}')
        BALANCE_SU=$(echo "$BALANCE_LINE" | awk '{print $4}')
    fi
    decho "Parsed from balance: alloc=$ALLOC_SU used=$USED_SU balance=$BALANCE_SU"
fi

# If balance didn't give us values, try allocations pipe table
if [[ -z "$ALLOC_SU" ]]; then
    ALLOC_SU=$(echo "$ALLOC_RAW" | grep -E "\|\s*${ACCOUNT}\s*\|" | grep -oE '[0-9]{5,}' | head -1)
fi

# Parse total usage from usage output as fallback
if [[ -z "$USED_SU" ]]; then
    USED_SU=$(echo "$USAGE_RAW" | grep -i 'Total Usage' | grep -oE '[0-9]+\.?[0-9]*' | tail -1)
fi

# Get allocation date from allocations table for burn rate calc
# Format: | ... | 2025-10-06 14:30:36 | ... |
ALLOC_DATE=$(echo "$ALLOC_RAW" | grep -E "\|\s*${ACCOUNT}\s*\|" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
decho "Allocation date: $ALLOC_DATE"

# Get cycle info from usage output: "Cycle: 2025-2026"
CYCLE_INFO=$(echo "$USAGE_RAW" | grep -i 'Cycle' | grep -oE '[0-9]{4}-[0-9]{4}' | head -1)
decho "Cycle: $CYCLE_INFO"

# Determine period end: use cycle end year + allocation start month/day,
# or default to cycle end year Oct 1 (RCC fiscal year typically starts Oct)
PERIOD_END=""
PERIOD_START=""
if [[ -n "$ALLOC_DATE" ]]; then
    PERIOD_START="$ALLOC_DATE"
fi
if [[ -n "$CYCLE_INFO" ]]; then
    CYCLE_END_YEAR=$(echo "$CYCLE_INFO" | cut -d'-' -f2)
    # RCC cycles are fiscal year: allocation start date to +1 year
    if [[ -n "$PERIOD_START" ]]; then
        # Period end = same month/day of start but in end year
        start_month_day=$(echo "$PERIOD_START" | cut -d'-' -f2-3)
        PERIOD_END="${CYCLE_END_YEAR}-${start_month_day}"
    else
        # Default: Oct 1 of end year
        PERIOD_END="${CYCLE_END_YEAR}-10-01"
    fi
fi

DAYS_LEFT="null"
if [[ -n "$PERIOD_END" ]]; then
    end_ts=$(date -d "$PERIOD_END" +%s 2>/dev/null)
    now_ts=$(date +%s)
    if [[ -n "$end_ts" && "$end_ts" -gt "$now_ts" ]]; then
        DAYS_LEFT=$(( (end_ts - now_ts) / 86400 ))
    fi
fi
decho "Period: $PERIOD_START → $PERIOD_END ($DAYS_LEFT days left)"

# Burn rate calculation
BURN_RATE="null"
PROJECTED_TOTAL="null"
PROJECTED_SURPLUS="null"
if [[ -n "$USED_SU" && -n "$PERIOD_START" && "$DAYS_LEFT" != "null" && -n "$ALLOC_SU" ]]; then
    now_ts=$(date +%s)
    start_ts=$(date -d "$PERIOD_START" +%s 2>/dev/null)
    if [[ -n "$start_ts" ]]; then
        elapsed_days=$(( (now_ts - start_ts) / 86400 ))
        if [[ "$elapsed_days" -gt 0 ]]; then
            BURN_RATE=$(awk "BEGIN{printf \"%.1f\", $USED_SU / $elapsed_days}")
            total_period_days=$(( elapsed_days + DAYS_LEFT ))
            PROJECTED_TOTAL=$(awk "BEGIN{printf \"%.0f\", $BURN_RATE * $total_period_days}")
            PROJECTED_SURPLUS=$(awk "BEGIN{printf \"%.0f\", $ALLOC_SU - $PROJECTED_TOTAL}")
        fi
    fi
fi

# by_user: from rcchelp usage --byuser
# Midway3 format: "cadavidsanchez         66546" (space-separated)
# Midway2 format: "| cil     | cadavidsanchez |    66546.68 |" (pipe-separated)
SU_BY_USER_JSON="["
if [[ -n "$USAGE_BYUSER_RAW" ]]; then
    first=1
    while IFS= read -r line; do
        u="$( echo "$line" | awk '{print $1}')"
        v="$( echo "$line" | awk '{print $2}')"
        [[ -z "$u" || -z "$v" ]] && continue
        [[ "$first" -eq 0 ]] && SU_BY_USER_JSON+=","
        SU_BY_USER_JSON+="{\"user\":$(json_str "$u"),\"consumed\":$v}"
        first=0
    done < <(
        if echo "$USAGE_BYUSER_RAW" | grep -q '|'; then
            # Pipe format: extract user and charge columns
            echo "$USAGE_BYUSER_RAW" \
                | grep '|' | grep -vE '^\+|Account|User|Charge' \
                | awk -F'|' '{
                    gsub(/[[:space:]]/,"",$3); gsub(/[[:space:]]/,"",$4);
                    if ($3 ~ /^[a-zA-Z]/ && $4 ~ /^[0-9]/) print $3, int($4)
                }' | sort -k2 -rn
        else
            # Space format
            echo "$USAGE_BYUSER_RAW" \
                | grep -vE '^(#|User|Total|$|=|-|Account|Cycle|Partition|Note|WARNING|usage:|accounts|This)' \
                | awk 'NF>=2 && $1~/^[a-zA-Z]/ && $2~/^[0-9]/ {print $1, int($2)}' \
                | sort -k2 -rn
        fi
    )
fi
SU_BY_USER_JSON+="]"

# by_partition: from rcchelp usage output
# Midway3 has partition breakdown in default output
# Midway2 may not have it (only shows per-user charge)
SU_BY_PART_JSON="["
PART_SOURCE="$USAGE_RAW"
[[ -z "$PART_SOURCE" ]] && PART_SOURCE="$USAGE_BYPART_RAW"
if [[ -n "$PART_SOURCE" ]]; then
    first=1
    while IFS= read -r line; do
        p=$(echo "$line" | awk '{print $1}')
        v=$(echo "$line" | awk '{print $2}')
        [[ -z "$p" || -z "$v" ]] && continue
        [[ "$v" == "0" ]] && continue
        [[ "$first" -eq 0 ]] && SU_BY_PART_JSON+=","
        SU_BY_PART_JSON+="{\"partition\":$(json_str "$p"),\"consumed\":$v}"
        first=0
    done < <(
        if echo "$PART_SOURCE" | grep -q '|'; then
            # Pipe format: look for partition-like names
            echo "$PART_SOURCE" \
                | grep '|' | grep -vE '^\+|Account|Partition|Charge' \
                | awk -F'|' '{
                    gsub(/[[:space:]]/,"",$2); gsub(/[[:space:]]/,"",$3);
                    if ($2 ~ /^[a-zA-Z]/ && $3 ~ /^[0-9]/) print $2, int($3)
                }' | sort -k2 -rn
        else
            # Space format
            echo "$PART_SOURCE" \
                | grep -vE '^(#|Partition|Total|$|=|-|Account|Cycle|Note|WARNING|usage:|accounts|This|itemized|report)' \
                | awk 'NF>=2 && $1~/^[a-zA-Z]/ && $2~/^[0-9]/ {print $1, int($2)}' \
                | sort -k2 -rn
        fi
    )
fi
SU_BY_PART_JSON+="]"

# =============================================================================
# COLLECT: Jobs
# =============================================================================
decho "Collecting jobs..."

# Fields: jobid|user|name|state|partition|reason|cpus|mem|elapsed|timelimit|timeleft|nodelist
SQUEUE_FMT="%i|%u|%j|%T|%P|%R|%C|%m|%M|%l|%L|%N"
JOBS_RAW=$(safe_run squeue -A "$ACCOUNT" -h -o "$SQUEUE_FMT")

decho "squeue lines: $(echo "$JOBS_RAW" | grep -c '.' 2>/dev/null)"

TOTAL_RUNNING=$(echo "$JOBS_RAW" | grep -c 'RUNNING' || true)
TOTAL_PENDING=$(echo "$JOBS_RAW" | grep -c 'PENDING' || true)
TOTAL_JOBS=$(echo "$JOBS_RAW" | grep -c '.' || true)
[[ -z "$JOBS_RAW" ]] && TOTAL_JOBS=0

# Build jobs.list JSON
JOBS_LIST_JSON="["
JOBS_FIRST=1
if [[ -n "$JOBS_RAW" && "$TOTAL_JOBS" -gt 0 ]]; then
    while IFS='|' read -r jobid user name state partition reason cpus mem elapsed timelimit timeleft nodelist; do
        [[ -z "$jobid" ]] && continue
        [[ "$JOBS_FIRST" -eq 0 ]] && JOBS_LIST_JSON+=","
        mem_str=$(echo "$mem" | tr -d ' ')
        JOBS_LIST_JSON+="{\"job_id\":$(json_str "$jobid")"
        JOBS_LIST_JSON+=",\"user\":$(json_str "$user")"
        JOBS_LIST_JSON+=",\"name\":$(json_str "$name")"
        JOBS_LIST_JSON+=",\"state\":$(json_str "$state")"
        JOBS_LIST_JSON+=",\"partition\":$(json_str "$partition")"
        JOBS_LIST_JSON+=",\"cpus\":$(json_int "$cpus")"
        JOBS_LIST_JSON+=",\"mem_alloc\":$(json_str "$mem_str")"
        JOBS_LIST_JSON+=",\"elapsed\":$(json_str "$elapsed")"
        JOBS_LIST_JSON+=",\"time_limit\":$(json_str "$timelimit")"
        JOBS_LIST_JSON+=",\"time_left\":$(json_str "$timeleft")"
        JOBS_LIST_JSON+=",\"node\":$(json_str "$nodelist")"
        JOBS_LIST_JSON+=",\"reason\":$(json_str "$reason")"
        JOBS_LIST_JSON+="}"
        JOBS_FIRST=0
    done <<< "$JOBS_RAW"
fi
JOBS_LIST_JSON+="]"

# Build jobs.by_user JSON using awk to aggregate
JOBS_BY_USER_JSON="[]"
if [[ -n "$JOBS_RAW" && "$TOTAL_JOBS" -gt 0 ]]; then
    result=$(echo "$JOBS_RAW" | awk -F'|' '
    function mem2gb(m) {
        if (m ~ /[Gg]$/) { gsub(/[Gg]$/,"",m); return m+0 }
        if (m ~ /[Mm]$/) { gsub(/[Mm]$/,"",m); return m/1024 }
        if (m ~ /[Tt]$/) { gsub(/[Tt]$/,"",m); return m*1024 }
        if (m ~ /^[0-9]+$/) { return m/1024 }
        return 0
    }
    {
        user=$2; state=$4; part=$5; cpus=$7+0; mem=$8
        if (user == "") next

        total[user]++
        if (state == "RUNNING") {
            run[user]++
            run_cpus[user] += cpus
            run_mem[user] += mem2gb(mem)
        }
        if (state == "PENDING") pend[user]++

        # Track partitions per user
        key = user "|" part
        part_total[key]++
        if (state == "RUNNING") part_run[key]++
        if (state == "PENDING") part_pend[key]++

        # Track which partitions each user uses
        if (!(key in seen_part)) {
            seen_part[key] = 1
            user_nparts[user]++
            user_part_list[user, user_nparts[user]] = part
        }
        users[user] = 1
    }
    END {
        first_user = 1
        printf "["
        for (u in users) {
            if (!first_user) printf ","
            first_user = 0

            printf "{\"user\":\"%s\"", u
            printf ",\"running\":%d", run[u]+0
            printf ",\"pending\":%d", pend[u]+0
            printf ",\"total\":%d", total[u]+0
            printf ",\"total_cpus\":%d", run_cpus[u]+0
            printf ",\"total_mem_alloc_gb\":%.1f", run_mem[u]+0

            printf ",\"by_partition\":["
            for (i = 1; i <= user_nparts[u]; i++) {
                p = user_part_list[u, i]
                if (i > 1) printf ","
                k = u "|" p
                printf "{\"partition\":\"%s\",\"running\":%d,\"pending\":%d}", p, part_run[k]+0, part_pend[k]+0
            }
            printf "]}"
        }
        printf "]"
    }')
    [[ -n "$result" ]] && JOBS_BY_USER_JSON="$result"
fi

# =============================================================================
# COLLECT: Partitions
# Build partition info for private partitions (and optionally shared ones).
# =============================================================================
decho "Collecting partition info..."

build_partition_json() {
    local part="$1"
    local is_private="$2"

    # Node-level info: node|state|cpuinfo(A/I/O/T)|free_mem_mb|total_mem_mb
    local sinfo_raw
    sinfo_raw=$(safe_run sinfo -p "$part" -N -h -o "%n|%T|%C|%e|%m")

    if [[ -z "$sinfo_raw" ]]; then
        add_error "sinfo -p $part" "no output" ""
        echo "{\"is_private\":$is_private,\"totals\":{},\"nodes\":[],\"sessions\":[],\"user_resources\":[]}"
        return
    fi

    # Sessions on this partition for our account
    local sess_raw
    sess_raw=$(safe_run squeue -p "$part" -A "$ACCOUNT" -h -o "%i|%u|%j|%T|%C|%m|%M|%l|%L|%N")

    # Build nodes array and accumulate totals
    local nodes_json="["
    local first_node=1
    local t_nodes=0 t_idle=0 t_mixed=0 t_alloc=0 t_down=0
    local t_cpus_alloc=0 t_cpus_total=0 t_mem_used=0 t_mem_total=0

    while IFS='|' read -r node state cpu_info free_mem total_mem; do
        [[ -z "$node" ]] && continue
        t_nodes=$((t_nodes + 1))

        local alloc_cpu idle_cpu total_cpu
        alloc_cpu=$(echo "$cpu_info" | cut -d'/' -f1)
        total_cpu=$(echo "$cpu_info" | cut -d'/' -f4)

        local total_mem_gb free_mem_gb used_mem_gb
        total_mem_gb=$(( ${total_mem:-0} / 1024 ))
        free_mem_gb=$(( ${free_mem:-0} / 1024 ))
        used_mem_gb=$(( total_mem_gb - free_mem_gb ))

        local cpu_pct=0 mem_pct=0
        [[ "$total_cpu" -gt 0 ]] && cpu_pct=$(awk "BEGIN{printf \"%.1f\", $alloc_cpu * 100.0 / $total_cpu}")
        [[ "$total_mem_gb" -gt 0 ]] && mem_pct=$(awk "BEGIN{printf \"%.1f\", $used_mem_gb * 100.0 / $total_mem_gb}")

        # Count state
        case "$state" in
            idle)            t_idle=$((t_idle+1)) ;;
            allocated|alloc) t_alloc=$((t_alloc+1)) ;;
            mixed|mix)       t_mixed=$((t_mixed+1)) ;;
            down*|drain*)    t_down=$((t_down+1)) ;;
        esac

        t_cpus_alloc=$((t_cpus_alloc + alloc_cpu))
        t_cpus_total=$((t_cpus_total + total_cpu))
        t_mem_used=$((t_mem_used + used_mem_gb))
        t_mem_total=$((t_mem_total + total_mem_gb))

        # Per-user detail on this node from squeue
        local node_users_json="["
        local first_nu=1
        if [[ -n "$sess_raw" ]]; then
            while IFS= read -r uline; do
                local nu_user nu_jobs nu_cpus nu_mem nu_elapsed
                nu_user=$(echo "$uline" | awk '{print $1}')
                nu_jobs=$(echo "$uline" | awk '{print $2}')
                nu_cpus=$(echo "$uline" | awk '{print $3}')
                nu_mem_gb=$(echo "$uline" | awk '{print $4}')
                nu_elapsed=$(echo "$uline" | awk '{print $5}')
                [[ -z "$nu_user" ]] && continue
                [[ "$first_nu" -eq 0 ]] && node_users_json+=","
                node_users_json+="{\"user\":$(json_str "$nu_user"),\"jobs\":$nu_jobs,\"cpus\":$nu_cpus,\"mem_alloc_gb\":$nu_mem_gb,\"elapsed\":$(json_str "$nu_elapsed")}"
                first_nu=0
            done < <(echo "$sess_raw" | awk -F'|' -v nd="$node" '
                function mem2gb(m) {
                    if (m ~ /[Gg]$/) { gsub(/[Gg]$/,"",m); return m+0 }
                    if (m ~ /[Mm]$/) { gsub(/[Mm]$/,"",m); return m/1024 }
                    if (m ~ /[Tt]$/) { gsub(/[Tt]$/,"",m); return m*1024 }
                    if (m ~ /^[0-9]+$/) { return m/1024 }
                    return 0
                }
                $10 ~ nd && $4 == "RUNNING" {
                    user=$2; cpus=$5+0; mem=$6; elapsed=$7
                    jobs[user]++; sum_cpus[user]+=cpus; sum_mem_gb[user]+=mem2gb(mem)
                    if (elapsed > max_elapsed[user]) max_elapsed[user]=elapsed
                }
                END {
                    for (u in jobs) printf "%s %d %d %.0f %s\n", u, jobs[u], sum_cpus[u], sum_mem_gb[u], max_elapsed[u]
                }')
        fi
        node_users_json+="]"

        [[ "$first_node" -eq 0 ]] && nodes_json+=","
        nodes_json+="{\"name\":$(json_str "$node")"
        nodes_json+=",\"state\":$(json_str "$state")"
        nodes_json+=",\"cpus_allocated\":$alloc_cpu,\"cpus_total\":$total_cpu,\"cpu_pct\":$cpu_pct"
        nodes_json+=",\"mem_used_gb\":$used_mem_gb,\"mem_total_gb\":$total_mem_gb,\"mem_pct\":$mem_pct"
        nodes_json+=",\"users\":$node_users_json}"
        first_node=0
    done <<< "$sinfo_raw"
    nodes_json+="]"

    # Totals
    local t_cpu_pct=0 t_mem_pct=0
    [[ "$t_cpus_total" -gt 0 ]] && t_cpu_pct=$(awk "BEGIN{printf \"%.1f\", $t_cpus_alloc * 100.0 / $t_cpus_total}")
    [[ "$t_mem_total" -gt 0 ]]  && t_mem_pct=$(awk "BEGIN{printf \"%.1f\", $t_mem_used * 100.0 / $t_mem_total}")

    local totals_json="{\"nodes_total\":$t_nodes,\"nodes_idle\":$t_idle,\"nodes_mixed\":$t_mixed"
    totals_json+=",\"nodes_allocated\":$t_alloc,\"nodes_down\":$t_down"
    totals_json+=",\"cpus_allocated\":$t_cpus_alloc,\"cpus_total\":$t_cpus_total,\"cpu_pct\":$t_cpu_pct"
    totals_json+=",\"mem_used_gb\":$t_mem_used,\"mem_total_gb\":$t_mem_total,\"mem_pct\":$t_mem_pct}"

    # Sessions
    local sessions_json="["
    local first_sess=1
    if [[ -n "$sess_raw" ]]; then
        while IFS='|' read -r sjobid suser sname sstate scpus smem selapsed stimelimit stimeleft snode; do
            [[ -z "$sjobid" ]] && continue
            [[ "$first_sess" -eq 0 ]] && sessions_json+=","
            sessions_json+="{\"job_id\":$(json_str "$sjobid")"
            sessions_json+=",\"user\":$(json_str "$suser")"
            sessions_json+=",\"name\":$(json_str "$sname")"
            sessions_json+=",\"state\":$(json_str "$sstate")"
            sessions_json+=",\"cpus\":$(json_int "$scpus")"
            sessions_json+=",\"mem_alloc\":$(json_str "$smem")"
            sessions_json+=",\"elapsed\":$(json_str "$selapsed")"
            sessions_json+=",\"time_limit\":$(json_str "$stimelimit")"
            sessions_json+=",\"time_left\":$(json_str "$stimeleft")"
            sessions_json+=",\"node\":$(json_str "$snode")"
            sessions_json+="}"
            first_sess=0
        done <<< "$sess_raw"
    fi
    sessions_json+="]"

    # user_resources: aggregate per-user on this partition
    local uresources_json="["
    if [[ -n "$sess_raw" ]]; then
        local first_ur=1
        while IFS= read -r urline; do
            local ur_user ur_running ur_pending ur_cpus ur_mem ur_nodes ur_elapsed ur_timeleft
            ur_user=$(echo "$urline" | awk -F'\t' '{print $1}')
            ur_running=$(echo "$urline" | awk -F'\t' '{print $2}')
            ur_pending=$(echo "$urline" | awk -F'\t' '{print $3}')
            ur_cpus=$(echo "$urline" | awk -F'\t' '{print $4}')
            ur_mem=$(echo "$urline" | awk -F'\t' '{print $5}')
            ur_nodes=$(echo "$urline" | awk -F'\t' '{print $6}')
            ur_elapsed=$(echo "$urline" | awk -F'\t' '{print $7}')
            ur_timeleft=$(echo "$urline" | awk -F'\t' '{print $8}')
            ur_timelimit=$(echo "$urline" | awk -F'\t' '{print $9}')
            [[ -z "$ur_user" ]] && continue
            # mem is already in GB from awk
            local ur_mem_gb="${ur_mem:-0}"
            # Format nodes as JSON array
            local nodes_arr="["
            local nfirst=1
            for n in $(echo "$ur_nodes" | tr ',' ' '); do
                [[ "$nfirst" -eq 0 ]] && nodes_arr+=","
                nodes_arr+="$(json_str "$n")"
                nfirst=0
            done
            nodes_arr+="]"

            [[ "$first_ur" -eq 0 ]] && uresources_json+=","
            uresources_json+="{\"user\":$(json_str "$ur_user")"
            uresources_json+=",\"jobs_running\":$ur_running"
            uresources_json+=",\"jobs_pending\":$ur_pending"
            uresources_json+=",\"cpus\":$ur_cpus"
            uresources_json+=",\"mem_alloc_gb\":$ur_mem_gb"
            uresources_json+=",\"nodes\":$nodes_arr"
            uresources_json+=",\"longest_elapsed\":$(json_str "$ur_elapsed")"
            uresources_json+=",\"max_time_limit\":$(json_str "$ur_timelimit")"
            uresources_json+=",\"shortest_time_left\":$(json_str "$ur_timeleft")"
            uresources_json+="}"
            first_ur=0
        done < <(echo "$sess_raw" | awk -F'|' '
        function mem2gb(m) {
            if (m ~ /[Gg]$/) { gsub(/[Gg]$/,"",m); return m+0 }
            if (m ~ /[Mm]$/) { gsub(/[Mm]$/,"",m); return m/1024 }
            if (m ~ /[Tt]$/) { gsub(/[Tt]$/,"",m); return m*1024 }
            if (m ~ /^[0-9]+$/) { return m/1024 }
            return 0
        }
        {
            user=$2; state=$4; cpus=$5+0; mem=$6; elapsed=$7; tlimit=$8; tleft=$9; node=$10
            if (user == "") next

            if (state == "RUNNING") {
                run[user]++
                run_cpus[user] += cpus
                run_mem_gb[user] += mem2gb(mem)

                # Nodes (unique)
                if (!(user SUBSEP node in seen_nodes)) {
                    seen_nodes[user SUBSEP node] = 1
                    if (nodes[user] == "") nodes[user] = node
                    else nodes[user] = nodes[user] "," node
                }

                # Longest elapsed
                if (elapsed > max_elapsed[user]) max_elapsed[user] = elapsed
                # Shortest time left (for running only)
                if (min_tleft[user] == "" || tleft < min_tleft[user]) min_tleft[user] = tleft
                # Max time limit
                if (tlimit > max_tlimit[user]) max_tlimit[user] = tlimit
            }
            if (state == "PENDING") pend[user]++
        }
        END {
            for (u in run) {
                printf "%s\t%d\t%d\t%d\t%.1f\t%s\t%s\t%s\t%s\n", \
                    u, run[u]+0, pend[u]+0, run_cpus[u]+0, run_mem_gb[u]+0, nodes[u], \
                    max_elapsed[u], min_tleft[u], max_tlimit[u]
            }
            # Users with only pending jobs
            for (u in pend) {
                if (!(u in run)) {
                    printf "%s\t0\t%d\t0\t0\t\t\t\t\n", u, pend[u]
                }
            }
        }')
    fi
    uresources_json+="]"

    echo "{\"is_private\":$is_private,\"totals\":$totals_json,\"nodes\":$nodes_json,\"sessions\":$sessions_json,\"user_resources\":$uresources_json}"
}

# Build partitions object
PARTITIONS_JSON="{"
PART_FIRST=1

# Private partitions
if [[ -n "$PRIVATE_PARTITIONS" ]]; then
    for part in $(echo "$PRIVATE_PARTITIONS" | tr ',' ' '); do
        decho "Scanning partition: $part"
        [[ "$PART_FIRST" -eq 0 ]] && PARTITIONS_JSON+=","
        pjson=$(build_partition_json "$part" "true")
        PARTITIONS_JSON+="$(json_str "$part"):$pjson"
        PART_FIRST=0
    done
fi
PARTITIONS_JSON+="}"

# =============================================================================
# COLLECT: Quota
# Actual format:
#   fileset          type                   used      quota      limit    grace
#   Midway3-home     blocks (user)        10.78G     30.00G     35.00G     none
#   Midway3-home     files  (user)        243358     300000    1000000     none
#   cil              blocks (group)      494.65T    500.00T    501.00T     none
# =============================================================================
decho "Collecting quota..."

QUOTA_RAW=$(safe_run rcchelp quota -a "$ACCOUNT")
decho "quota raw:\n$QUOTA_RAW"

QUOTA_JSON="null"
if [[ -n "$QUOTA_RAW" ]] && echo "$QUOTA_RAW" | grep -qE 'blocks|files'; then
    # Use python for reliable parsing of this complex format
    QUOTA_JSON=$(echo "$QUOTA_RAW" | python3 -c '
import sys, json, re

lines = sys.stdin.read().splitlines()
filesystems = {}  # key: (fileset, type) -> {space_*, files_*}

def parse_size_gb(s):
    """Convert size string like 2.47G, 494.65T, 100.00G, 0.00K to GB"""
    s = s.strip()
    m = re.match(r"^([0-9.]+)([KMGTP]?)$", s, re.I)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2).upper()
    if unit == "K": return val / (1024*1024)
    if unit == "M": return val / 1024
    if unit == "G": return val
    if unit == "T": return val * 1024
    if unit == "P": return val * 1024 * 1024
    return val  # no unit = assume GB

last_fileset = None
current_section = ""  # track "Capacity", "Cost-Effective", etc.
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("-") or stripped.startswith("Quota") or stripped.startswith("fileset"):
        continue

    # Capture section headers like ">>> Capacity Filesystem: project ..."
    if stripped.startswith(">>>"):
        sm = re.match(r">>>\s*(\S+)\s+Filesystem", stripped)
        if sm:
            current_section = sm.group(1)  # "Capacity" or "Cost-Effective"
        continue

    # Match: fileset  blocks/files  (user/group)  used  quota  limit  grace
    m = re.match(
        r"^(\S+)\s+(blocks|files)\s+\((\w+)\)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)",
        stripped
    )
    # Also handle continuation lines where fileset is blank (Midway2):
    #                  files  (user)          5416     300000    1000000     none
    if not m:
        m = re.match(
            r"^\s+(blocks|files)\s+\((\w+)\)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)",
            line  # use original line with leading spaces
        )
        if m and last_fileset:
            fileset = last_fileset
            kind = m.group(1)
            qtype = m.group(2)
            used = m.group(3)
            quota = m.group(4)
            limit = m.group(5)
        else:
            continue
    else:
        fileset = m.group(1)
        kind = m.group(2)
        qtype = m.group(3)
        used = m.group(4)
        quota = m.group(5)
        limit = m.group(6)
        last_fileset = fileset

    # Disambiguate duplicate filesets (e.g. "cil" in both Capacity and Cost-Effective)
    display_name = fileset
    if current_section and qtype == "group":
        display_name = f"{fileset} ({current_section})"

    key = (display_name, qtype)
    if key not in filesystems:
        filesystems[key] = {
            "filesystem": display_name,
            "type": qtype,
            "space_used_gb": None, "space_limit_gb": None, "space_pct": None,
            "files_used": None, "files_limit": None, "files_pct": None,
        }

    fs = filesystems[key]
    if kind == "blocks":
        u = parse_size_gb(used)
        q = parse_size_gb(quota)
        fs["space_used_gb"] = round(u, 2) if u is not None else None
        fs["space_limit_gb"] = round(q, 2) if q is not None else None
        if u is not None and q is not None and q > 0:
            fs["space_pct"] = round(u / q * 100, 1)
    elif kind == "files":
        try:
            fu = int(used)
            fq = int(quota)
            fs["files_used"] = fu
            fs["files_limit"] = fq
            if fq > 0:
                fs["files_pct"] = round(fu / fq * 100, 1)
        except ValueError:
            pass

result = {"filesystems": list(filesystems.values())}
print(json.dumps(result))
' 2>/dev/null)

    # If python parsing failed, set to null
    if [[ -z "$QUOTA_JSON" ]] || ! echo "$QUOTA_JSON" | python3 -m json.tool >/dev/null 2>&1; then
        QUOTA_JSON="null"
        add_error "rcchelp quota" "failed to parse quota output" "$QUOTA_RAW"
    fi
fi

# =============================================================================
# Calculate scan duration
# =============================================================================
ts_end=$(date +%s%N)
SCAN_DURATION=$(awk "BEGIN{printf \"%.1f\", ($ts_end - $ts_start) / 1000000000}")

# =============================================================================
# COLLECT: Group members (from system group database)
# =============================================================================
GROUP_MEMBERS_JSON="[]"
GROUP_RAW=$(getent group "$ACCOUNT" 2>/dev/null)
if [[ -n "$GROUP_RAW" ]]; then
    members_csv=$(echo "$GROUP_RAW" | cut -d: -f4)
    GROUP_MEMBERS_JSON="["
    gm_first=1
    IFS=',' read -ra MEMBERS <<< "$members_csv"
    for m in "${MEMBERS[@]}"; do
        [[ -z "$m" ]] && continue
        [[ "$gm_first" -eq 0 ]] && GROUP_MEMBERS_JSON+=","
        GROUP_MEMBERS_JSON+="$(json_str "$m")"
        gm_first=0
    done
    GROUP_MEMBERS_JSON+="]"
fi

# =============================================================================
# ASSEMBLE FULL JSON
# =============================================================================
FULL_JSON="{"

# meta
FULL_JSON+="\"meta\":{\"timestamp\":$(json_str "$(now_iso)")"
FULL_JSON+=",\"cluster\":$(json_str "$CLUSTER")"
FULL_JSON+=",\"hostname\":$(json_str "$HOSTNAME_SHORT")"
FULL_JSON+=",\"account\":$(json_str "$ACCOUNT")"
FULL_JSON+=",\"scan_version\":$(json_str "$SCAN_VERSION")"
FULL_JSON+=",\"scan_duration_sec\":$SCAN_DURATION}"

# service_units
FULL_JSON+=",\"service_units\":{\"allocated\":$(json_num "$ALLOC_SU")"
FULL_JSON+=",\"consumed\":$(json_num "$USED_SU")"
FULL_JSON+=",\"remaining\":$(json_num "$BALANCE_SU")"
FULL_JSON+=",\"period_end\":$(if [[ -n "$PERIOD_END" ]]; then json_str "$PERIOD_END"; else echo null; fi)"
FULL_JSON+=",\"days_left\":$(json_int "$DAYS_LEFT")"
FULL_JSON+=",\"burn_rate\":{\"sus_per_day_avg\":$(json_num "$BURN_RATE")"
FULL_JSON+=",\"projected_total\":$(json_num "$PROJECTED_TOTAL")"
FULL_JSON+=",\"projected_surplus\":$(json_num "$PROJECTED_SURPLUS")}"
FULL_JSON+=",\"by_user\":$SU_BY_USER_JSON"
FULL_JSON+=",\"by_partition\":$SU_BY_PART_JSON}"

# jobs
FULL_JSON+=",\"jobs\":{\"running\":$TOTAL_RUNNING,\"pending\":$TOTAL_PENDING,\"total\":$TOTAL_JOBS"
FULL_JSON+=",\"by_user\":$JOBS_BY_USER_JSON"
FULL_JSON+=",\"list\":$JOBS_LIST_JSON}"

# partitions
FULL_JSON+=",\"partitions\":$PARTITIONS_JSON"

# quota
FULL_JSON+=",\"quota\":$QUOTA_JSON"

# errors
FULL_JSON+=",\"errors\":$ERRORS_JSON"

# group members
FULL_JSON+=",\"group_members\":$GROUP_MEMBERS_JSON"

FULL_JSON+="}"

# =============================================================================
# OUTPUT
# =============================================================================
if [[ "$OUTPUT_MODE" == "json" ]]; then
    if [[ -n "$OUTDIR" ]]; then
        mkdir -p "$OUTDIR"
        FILENAME="scan_${CLUSTER}_$(date '+%Y%m%d-%H%M%S').json"
        OUTPATH="${OUTDIR}/${FILENAME}"
        echo "$FULL_JSON" | python3 -m json.tool > "$OUTPATH" 2>/dev/null \
            || echo "$FULL_JSON" > "$OUTPATH"
        echo "$OUTPATH"
    else
        echo "$FULL_JSON" | python3 -m json.tool 2>/dev/null \
            || echo "$FULL_JSON"
    fi
    exit 0
fi

# =============================================================================
# TERMINAL OUTPUT (pretty print)
# =============================================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; WHITE='\033[1;37m'; PURPLE='\033[0;35m'; DIM='\033[2m'
NC='\033[0m'; BOLD='\033[1m'

pbar() {
    local cur=$1 tot=$2 width=20 fill empty pct color
    [[ "$tot" -eq 0 ]] && { printf "[%-${width}s] N/A" ""; return; }
    pct=$(( cur * 100 / tot )); fill=$(( cur * width / tot )); empty=$(( width - fill ))
    if [ $pct -lt 50 ]; then color=$GREEN; elif [ $pct -lt 80 ]; then color=$YELLOW; else color=$RED; fi
    printf "[${color}"; printf "%${fill}s" "" | tr ' ' '#'
    printf "${DIM}"; printf "%${empty}s" "" | tr ' ' '-'
    printf "${NC}] ${color}%3d%%${NC}" $pct
}

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
clear
echo
echo -e "${BOLD}${BLUE}CIL Compute Status${NC}  ${DIM}(v${SCAN_VERSION})${NC}"
echo -e "  Account : ${CYAN}${ACCOUNT}${NC}   Cluster : ${CYAN}${CLUSTER}${NC}   Host : ${DIM}${HOSTNAME_SHORT}${NC}"
echo -e "  ${DIM}${TIMESTAMP}   scan took ${SCAN_DURATION}s${NC}"
echo

# Service Units
echo -e "${BOLD}${CYAN}SERVICE UNITS${NC}"
echo -e "${DIM}----------------------------------------------------------------------${NC}"
if [[ -n "$BALANCE_SU" && -n "$ALLOC_SU" ]]; then
    printf "  Allocation : %'12.0f SUs\n" "$ALLOC_SU"
    printf "  Consumed   : ${YELLOW}%'12.0f SUs${NC}\n" "${USED_SU:-0}"
    printf "  Remaining  : ${GREEN}%'12.0f SUs${NC}\n" "$BALANCE_SU"
    echo
    printf "  Usage : "; pbar "${USED_SU%.*}" "${ALLOC_SU%.*}" 2>/dev/null; echo
else
    echo -e "  ${YELLOW}Could not parse SU values. Run with --debug to inspect raw output.${NC}"
fi
if [[ "$DAYS_LEFT" != "null" && -n "$PERIOD_END" ]]; then
    if [ "$DAYS_LEFT" -lt 14 ]; then dc=$RED
    elif [ "$DAYS_LEFT" -lt 30 ]; then dc=$YELLOW
    else dc=$GREEN; fi
    echo -e "  ${dc}Period ends: ${BOLD}${PERIOD_END}${NC}  ${dc}(${DAYS_LEFT} days)${NC}"
fi

# SU by user
echo
echo -e "${BOLD}${CYAN}SU USAGE BY USER${NC}"
echo -e "${DIM}----------------------------------------------------------------------${NC}"
printf "  ${BOLD}%-22s %14s${NC}\n" "User" "SUs consumed"
echo "$SU_BY_USER_JSON" | python3 -c "
import sys,json
for u in json.load(sys.stdin):
    print(f\"  {u['user']:<22s} {u['consumed']:>14,.0f}\")
" 2>/dev/null || echo -e "  ${DIM}(parsing error)${NC}"

# SU by partition
echo
echo -e "${BOLD}${CYAN}SU USAGE BY PARTITION${NC}"
echo -e "${DIM}----------------------------------------------------------------------${NC}"
printf "  ${BOLD}%-22s %14s${NC}\n" "Partition" "SUs consumed"
echo "$SU_BY_PART_JSON" | python3 -c "
import sys,json
for p in json.load(sys.stdin):
    print(f\"  {p['partition']:<22s} {p['consumed']:>14,.0f}\")
" 2>/dev/null || echo -e "  ${DIM}(parsing error)${NC}"

# Jobs
echo
echo -e "${BOLD}${CYAN}ACTIVE JOBS${NC}"
echo -e "${DIM}----------------------------------------------------------------------${NC}"
echo -e "  Running: ${GREEN}${TOTAL_RUNNING}${NC}   Pending: ${YELLOW}${TOTAL_PENDING}${NC}   Total: ${WHITE}${TOTAL_JOBS}${NC}"

if [[ "$TOTAL_JOBS" -gt 0 ]]; then
    echo
    printf "  ${BOLD}%-14s %-10s %-10s %-10s %-6s %-8s %-10s %-10s %-10s${NC}\n" \
        "User" "State" "Partition" "JobID" "CPUs" "Mem" "Elapsed" "Limit" "Left"
    echo "$JOBS_LIST_JSON" | python3 -c "
import sys,json
C={'RUNNING':'\033[0;32m','PENDING':'\033[1;33m'}; R='\033[0m'
for j in json.load(sys.stdin):
    c=C.get(j['state'],'\033[2m')
    print(f\"  {j['user']:<14s} {c}{j['state']:<10s}{R} {j['partition']:<10s} {j['job_id']:<10s} {j.get('cpus',''):<6} {j.get('mem_alloc',''):<8s} {j.get('elapsed',''):<10s} {j.get('time_limit',''):<10s} {j.get('time_left',''):<10s}\")
" 2>/dev/null
fi

# Private Partitions
if [[ -n "$PRIVATE_PARTITIONS" ]]; then
    for part in $(echo "$PRIVATE_PARTITIONS" | tr ',' ' '); do
        echo
        echo -e "${BOLD}${PURPLE}PARTITION: ${part}${NC}"
        echo -e "${DIM}----------------------------------------------------------------------${NC}"

        # Extract partition data and display
        echo "$PARTITIONS_JSON" | python3 -c "
import sys,json
data = json.load(sys.stdin).get('$part', {})
t = data.get('totals', {})
if t:
    cpct = t.get('cpu_pct',0); mpct = t.get('mem_pct',0)
    print(f\"  Nodes: {t.get('nodes_total',0)} (idle:{t.get('nodes_idle',0)} mixed:{t.get('nodes_mixed',0)} alloc:{t.get('nodes_allocated',0)} down:{t.get('nodes_down',0)})\")
    print(f\"  CPU: {t.get('cpus_allocated',0)}/{t.get('cpus_total',0)} ({cpct:.0f}%)   Mem: {t.get('mem_used_gb',0)}/{t.get('mem_total_gb',0)} GB ({mpct:.0f}%)\")
print()

# user_resources table
ur = data.get('user_resources', [])
if ur:
    print(f\"  {'User':<16s} {'Run':>4s} {'Pend':>4s} {'CPUs':>5s} {'Mem(GB)':>8s} {'Elapsed':>10s} {'Limit':>10s} {'Left':>10s}  Nodes\")
    for u in sorted(ur, key=lambda x: x.get('cpus',0), reverse=True):
        ns = ','.join(u.get('nodes',[])) or '-'
        print(f\"  {u['user']:<16s} {u.get('jobs_running',0):>4d} {u.get('jobs_pending',0):>4d} {u.get('cpus',0):>5d} {u.get('mem_alloc_gb',0):>8.0f} {u.get('longest_elapsed',''):>10s} {u.get('max_time_limit',''):>10s} {u.get('shortest_time_left',''):>10s}  {ns}\")
else:
    print('  No active users.')
" 2>/dev/null
    done
fi

echo
echo -e "${DIM}Cluster: ${CLUSTER}  |  Account: ${ACCOUNT}  |  ${TIMESTAMP}${NC}"
echo -e "${DIM}Tip: --json for machine-readable output, --debug for raw command data.${NC}"
echo