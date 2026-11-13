#!/bin/bash
# Regression tests for the RCC Slurm chain scripts, run locally against fake
# sbatch/squeue/sacct/scancel/hostname commands. No cluster needed.
#
#   bash scanner/tests/chain_scripts_test.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
FAIL=0; PASS=0
ok()  { PASS=$((PASS + 1)); echo "  ok   $*"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $*"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# ---------------------------------------------------------------- fakes ----
mkdir -p "$T/bin"
cat > "$T/bin/sbatch" <<'EOF'
#!/bin/bash
# Records the call; registers a PENDING job named by --job-name / -J.
echo "$*" >> "$FAKE/sbatch.log"
id=$(( $(cat "$FAKE/next_id" 2>/dev/null || echo 1000) + 1 )); echo $id > "$FAKE/next_id"
name=$(printf '%s\n' "$@" | sed -n 's/^--job-name=//p' | head -1)
echo "$id PENDING ${name:-unnamed} N/A" >> "$FAKE/queue"
echo "$id"
EOF
cat > "$T/bin/squeue" <<'EOF'
#!/bin/bash
name=""; fmt="%i"
while [ $# -gt 0 ]; do case "$1" in -n) name="$2"; shift 2;; -o) fmt="$2"; shift 2;; *) shift;; esac; done
[ -f "$FAKE/queue" ] || exit 0
awk -v n="$name" -v f="$fmt" '(n == "" || $3 == n) { if (f == "%i") print $1; else print $1, $2, $4 }' "$FAKE/queue"
EOF
cat > "$T/bin/scancel" <<'EOF'
#!/bin/bash
echo "$*" >> "$FAKE/scancel.log"; sed -i "/^$1 /d" "$FAKE/queue"
EOF
cat > "$T/bin/sacct" <<'EOF'
#!/bin/bash
cat "$FAKE/sacct.out" 2>/dev/null
EOF
printf '#!/bin/bash\necho "${FAKE_HOSTNAME:-midway3-login1}"\n' > "$T/bin/hostname"
printf '#!/bin/bash\nexit 0\n' > "$T/bin/sleep"
chmod +x "$T/bin/"*

reset_fake() {
  export FAKE="$T/fake.$1"; rm -rf "$FAKE"; mkdir -p "$FAKE"; : > "$FAKE/queue"
}
run() { # run a chain script as Slurm job "$1" named "$2" with extra args
  local id="$1" name="$2"; shift 2
  (cd "$REPO" && PATH="$T/bin:$PATH" SLURM_JOB_ID="$id" SLURM_JOB_NAME="$name" \
     SLURM_SUBMIT_DIR="$REPO" SLURM_JOB_ACCOUNT=pi-test CIL_SCAN_OUTPUT_DIR="$T/scratch" \
     bash "$@")
}

# ------------------------------------------------------------- chain.sh ----
echo "chain.sh"
reset_fake a
out=$(run 500 cil_computing_scan -c 'CHAIN_SCRIPT=scanner/scripts/daily_pipeline_computing.sh
  source scanner/scripts/lib/chain.sh; chain_init >/dev/null; chain_schedule_next 2030-01-01T00:15:00; echo WORKED')
args=$(cat "$FAKE/sbatch.log")
check "schedules the next run" '[ "$(wc -l < "$FAKE/sbatch.log")" = 1 ]'
check "resubmits the repository script, not \$0" '[[ "$args" == *"$REPO/scanner/scripts/daily_pipeline_computing.sh"* ]]'
check "uses singleton, absolute logs, failure mail, inherited account" \
  '[[ "$args" == *--dependency=singleton* && "$args" == *"--output=$REPO/slurm_out/"* && "$args" == *--mail-type=FAIL* && "$args" == *--account=pi-test* ]]'
check "work continues after scheduling" '[[ "$out" == *WORKED* ]]'

reset_fake b
echo "77 PENDING cil_computing_scan 2030-01-01T00:15:00" > "$FAKE/queue"
out=$(run 500 cil_computing_scan -c 'CHAIN_SCRIPT=scanner/scripts/daily_pipeline_computing.sh
  source scanner/scripts/lib/chain.sh; chain_init >/dev/null; chain_schedule_next 2030; echo WORKED')
check "duplicate chain (next run already queued) exits without work" '[[ "$out" != *WORKED* && ! -s "$FAKE/sbatch.log" ]]'

reset_fake c
echo "88 RUNNING cil_daily_pipeline now" > "$FAKE/queue"
out=$(run 500 cil_daily_pipeline -c 'CHAIN_SCRIPT=scanner/scripts/daily_pipeline.sh
  source scanner/scripts/lib/chain.sh; chain_init >/dev/null; chain_guard_overlap; echo WORKED')
check "overlap guard stops a second running instance" '[[ "$out" != *WORKED* ]]'

reset_fake d
echo 2000 > "$FAKE/next_id"   # our submission gets 2001
echo "1500 PENDING cil_computing_scan later" > "$FAKE/queue.race"
cat > "$T/bin/sleep" <<EOF
#!/bin/bash
cat "\$FAKE/queue.race" >> "\$FAKE/queue" 2>/dev/null; rm -f "\$FAKE/queue.race"
EOF
chmod +x "$T/bin/sleep"
run 500 cil_computing_scan -c 'CHAIN_SCRIPT=scanner/scripts/daily_pipeline_computing.sh
  source scanner/scripts/lib/chain.sh; chain_init >/dev/null; chain_schedule_next 2030' >/dev/null
check "race: higher-id duplicate submission cancels itself" 'grep -q "^2001" "$FAKE/scancel.log" && grep -q "^1500 " "$FAKE/queue"'
printf '#!/bin/bash\nexit 0\n' > "$T/bin/sleep"

reset_fake e
CHAIN_ONCE=1 run 500 cil_daily_pipeline -c 'CHAIN_SCRIPT=scanner/scripts/daily_pipeline.sh
  source scanner/scripts/lib/chain.sh; chain_init >/dev/null; chain_schedule_next 2030' >/dev/null
check "CHAIN_ONCE=1 never schedules" '[ ! -s "$FAKE/sbatch.log" ]'

q=$(bash -c 'source '"$REPO"'/scanner/scripts/lib/chain.sh; chain_next_quarter 2')
mm=$(date -d "$q" +%M); secs=$(( $(date -d "$q" +%s) - $(date +%s) ))
check "next quarter + 2 min lands on :02/:17/:32/:47 within 17 min" '[[ "$mm" =~ ^(02|17|32|47)$ ]] && [ "$secs" -gt 0 ] && [ "$secs" -le 1020 ]'

# ------------------------------------------------------ daily_pipeline.sh ---
echo "daily_pipeline.sh"
reset_fake f; mkdir -p "$T/scratch"
run 600 cil_daily_pipeline scanner/scripts/daily_pipeline.sh > "$FAKE/out" 2>&1
log=$(cat "$FAKE/sbatch.log")
check "queues tomorrow's run first" 'head -1 "$FAKE/sbatch.log" | grep -q -- "--begin=$(date -d tomorrow +%Y-%m-%d)T02:00:00"'
check "submits the scan array with one SCAN_DATE" 'grep -q -- "--job-name=cil_scan .*SCAN_DATE=$(date +%Y-%m-%d)" "$FAKE/sbatch.log"'
check "finalize depends on the array (afterany)" 'grep -q -- "--dependency=afterany:1002 .*--finalize 1002 $(date +%Y-%m-%d)" "$FAKE/sbatch.log"'
check "marks the scan as running" '[ -f "$T/scratch/.scan_running" ]'

reset_fake f2
CIL_SCAN_INTERVAL_DAYS=7 CIL_SCAN_CPUS=4 run 604 cil_daily_pipeline scanner/scripts/daily_pipeline.sh > "$FAKE/out" 2>&1
check "CIL_SCAN_INTERVAL_DAYS sets the next run" 'head -1 "$FAKE/sbatch.log" | grep -q -- "--begin=$(date -d "+7 days" +%Y-%m-%d)T02:00:00"'
check "CIL_SCAN_CPUS sets scanner threads per source" 'grep -q -- "--job-name=cil_scan --cpus-per-task=4" "$FAKE/sbatch.log"'

reset_fake g
echo "99 RUNNING cil_scan now" > "$FAKE/queue"
run 601 cil_daily_pipeline scanner/scripts/daily_pipeline.sh > "$FAKE/out" 2>&1
check "does not start a second scan array" '[ "$(grep -c -- "--job-name=cil_scan " "$FAKE/sbatch.log")" = 0 ]'

D=2030-01-02
for s in battuta-shares-S3-archive battuta_shares gcp home_dirs kupe_shares norgay sacagawea_shares coastal; do
  printf '{\n  "total_rows": 10,\n  "completed": true\n}\n' > "$T/scratch/${s}_${D}_manifest.json"
done
reset_fake h; printf '1_0 COMPLETED\n1_1 COMPLETED\n' > "$FAKE/sacct.out"
rm -f "$T/scratch/.scan_complete"
run 602 cil_scan_finalize scanner/scripts/daily_pipeline.sh --finalize 1 "$D" > "$FAKE/out" 2>&1; rc=$?
check "finalize writes the flag when every source completed" '[ $rc = 0 ] && grep -q "rows=80" "$T/scratch/.scan_complete" && [ ! -f "$T/scratch/.scan_running" ]'
printf '{ "total_rows": 3, "completed": false }\n' > "$T/scratch/gcp_${D}_manifest.json"
rm -f "$T/scratch/.scan_complete"
run 603 cil_scan_finalize scanner/scripts/daily_pipeline.sh --finalize 1 "$D" > "$FAKE/out" 2>&1; rc=$?
check "finalize refuses a partial snapshot (exit 1, no flag)" '[ $rc = 1 ] && [ ! -f "$T/scratch/.scan_complete" ] && grep -q "gcp" "$FAKE/out"'

# ---------------------------------------------------- scan_cil_parallel.sh ---
echo "scan_cil_parallel.sh"
mkdir -p "$T/repo/scanner/target/release" "$T/repo/slurm_out"
cat > "$T/repo/scanner/target/release/storage-scanner" <<'EOF'
#!/bin/bash
out=""; while [ $# -gt 0 ]; do [ "$1" = --output ] && out="$2"; echo "$1" >> "$FAKE/scanner.args"; shift; done
base="${out%.parquet}"; echo data > "${base}_chunk_0001.parquet"
printf '{ "total_rows": 5, "completed": true }\n' > "${base}_manifest.json"
EOF
chmod +x "$T/repo/scanner/target/release/storage-scanner"
reset_fake i; S2="$T/scratch2"; mkdir -p "$S2"; D=2030-01-03
echo old > "$S2/gcp_${D}_chunk_0001.parquet"; printf '{ "completed": false }\n' > "$S2/gcp_${D}_manifest.json"
(cd "$T/repo" && SLURM_ARRAY_TASK_ID=2 SCAN_DATE=$D CIL_SCAN_OUTPUT_DIR="$S2" SLURM_CPUS_PER_TASK=2 \
   bash "$REPO/scanner/scripts/scan_cil_parallel.sh" > "$FAKE/out" 2>&1)
check "partial attempt is moved aside, not deleted" '[ "$(cat "$S2"/.partial/gcp_${D}_*/gcp_${D}_chunk_0001.parquet)" = old ]'
check "rescans without --resume" 'grep -q -- --incremental "$FAKE/scanner.args" && ! grep -q -- --resume "$FAKE/scanner.args"'
: > "$FAKE/scanner.args"
(cd "$T/repo" && SLURM_ARRAY_TASK_ID=2 SCAN_DATE=$D CIL_SCAN_OUTPUT_DIR="$S2" SLURM_CPUS_PER_TASK=2 \
   bash "$REPO/scanner/scripts/scan_cil_parallel.sh" > "$FAKE/out" 2>&1)
check "a completed source is skipped on rerun (no filesystem scan)" '[ ! -s "$FAKE/scanner.args" ] && grep -q "Already complete" "$FAKE/out"'

# -------------------------------------------------------- publish_scans.sh ---
echo "publish_scans.sh"
SRC="$T/pub_src"; HOMEDIR="$T/home"; PUB="$HOMEDIR/public_html/cil_scans"
mkdir -p "$SRC/.partial/x" "$PUB/quotas"
echo new > "$SRC/gcp_2030-01-05_chunk_0001.parquet"; echo m > "$SRC/gcp_2030-01-05_manifest.json"
echo flag > "$SRC/.scan_complete"; echo keep > "$SRC/.partial/x/a"
echo old > "$PUB/gcp_2030-01-01_chunk_0001.parquet"; echo c > "$PUB/cds3_2029-12-01_manifest.json"; echo q > "$PUB/quotas/latest.json"
PATH="$T/bin:$PATH" FAKE_HOSTNAME=midway2-login1 HOME="$HOMEDIR" SOURCE_DIR="$SRC" \
  bash "$REPO/scanner/scripts/publish_scans.sh" --clean > "$T/pub.out" 2>&1; rc=$?
check "publishes the new scan" '[ $rc = 0 ] && [ "$(cat "$PUB/gcp_2030-01-05_chunk_0001.parquet")" = new ]'
check "prunes the older scan but keeps cds3 and subdirectories" '[ ! -e "$PUB/gcp_2030-01-01_chunk_0001.parquet" ] && [ -e "$PUB/cds3_2029-12-01_manifest.json" ] && [ -e "$PUB/quotas/latest.json" ]'
check "writes the completion marker" 'grep -q "dates=2030-01-05" "$PUB/latest_published.txt"'
check "never publishes dot-files" '[ ! -e "$PUB/.scan_complete" ] && [ ! -e "$PUB/.partial" ]'
check "--clean removes only published files and the flag" '[ ! -e "$SRC/gcp_2030-01-05_chunk_0001.parquet" ] && [ ! -e "$SRC/.scan_complete" ] && [ -e "$SRC/.partial/x/a" ]'

# ------------------------------------------------- partitions / accounts ---
echo "partitions and accounts"
hdr() { sed -n "s/^#SBATCH --$2=//p" "$REPO/scanner/scripts/$1"; }
for s in daily_pipeline.sh scan_cil_parallel.sh daily_pipeline_computing.sh; do
  check "Midway3 $s runs on partition cil with account pi-mgreenst" '[ "$(hdr $s partition)" = cil ] && [ "$(hdr $s account)" = pi-mgreenst ]'
done
for s in daily_publish.sh daily_publish_computing.sh; do
  check "Midway2 $s runs on partition broadwl with account pi-mgreenst" '[ "$(hdr $s partition)" = broadwl ] && [ "$(hdr $s account)" = pi-mgreenst ]'
done
check "no sbatch call overrides the partition (headers decide)" '! grep -nE "sbatch[^#]*--partition" "$REPO"/scanner/scripts/*.sh "$REPO"/scanner/scripts/lib/chain.sh'
out=$(cd "$REPO" && env -u SLURM_JOB_ACCOUNT -u CIL_SLURM_ACCOUNT bash -c 'CHAIN_SCRIPT=scanner/scripts/daily_pipeline.sh; source scanner/scripts/lib/chain.sh; chain_init >/dev/null; echo "$ACCOUNT"')
check "fallback billing account is pi-mgreenst" '[ "$out" = pi-mgreenst ]'

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
