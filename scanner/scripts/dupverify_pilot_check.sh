#!/bin/bash
# =============================================================================
# dupverify_pilot_check.sh — preflight and postflight checks for a pilot run
# of cil-dupverify on RCC. Read-only: it inspects, it never submits, cancels
# or modifies jobs, checkouts or files (other than writing its own snapshot
# files into PILOT_DIR).
#
#   bash scanner/scripts/dupverify_pilot_check.sh pre
#   bash scanner/scripts/dupverify_pilot_check.sh post <jobid>
#
# Environment (defaults match Pilot 0):
#   PILOT_DIR        $HOME/dupverify/pilot0
#   CANDIDATES       $PILOT_DIR/cand_pilot0.jsonl
#   OUT              $PILOT_DIR/out
#   DUPV_BIN         verifier binary (required)
#   PROD_CHECKOUT    the RCC checkout used by the scheduled chains (required)
#   EXPECT_SHA       commit the pilot clone must be at (required)
#   EXPECT_SHA256    checksum of the candidate file computed on the workstation (required)
#   EXPECT_GROUPS=40 EXPECT_FILES=157 EXPECT_SAMPLE_BYTES=51445760
#   PARTITION=cil    JOB_NAME=cil_dupverify
#
# Output never contains candidate paths or file names. Exit 0 = no FAIL.
# =============================================================================
set -u
MODE="${1:-}"
JOBID="${2:-}"
PILOT_DIR="${PILOT_DIR:-$HOME/dupverify/pilot0}"
CANDIDATES="${CANDIDATES:-$PILOT_DIR/cand_pilot0.jsonl}"
OUT="${OUT:-$PILOT_DIR/out}"
PARTITION="${PARTITION:-cil}"
JOB_NAME="${JOB_NAME:-cil_dupverify}"
EXPECT_GROUPS="${EXPECT_GROUPS:-40}"
EXPECT_FILES="${EXPECT_FILES:-157}"
EXPECT_SAMPLE_BYTES="${EXPECT_SAMPLE_BYTES:-51445760}"
CLONE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUMMARIZE="$CLONE/scripts/dupverify/summarize_results.py"
FAILS=0

pass() { echo "  PASS  $*"; }
warn() { echo "  WARN  $*"; }
fail() { echo "  FAIL  $*"; FAILS=$((FAILS + 1)); }
need() { [ -n "${!1:-}" ] || { echo "set $1 (see header)"; exit 2; }; }
mode_of() { stat -c '%a' "$1" 2>/dev/null; }
private_dir() { local m; m=$(mode_of "$1"); [ "$m" = 700 ] && pass "$2 is private (700)" || fail "$2 mode is ${m:-missing}, want 700"; }
private_file() { local m; m=$(mode_of "$1"); [ "$m" = 600 ] && pass "$2 is private (600)" || fail "$2 mode is ${m:-missing}, want 600"; }

# Job ids and names only (no paths), for before/after comparison.
jobs_snapshot() { squeue -u "$USER" -h -o '%i %j %P %T %S' 2>/dev/null | sort; }
prod_state() { git -C "$PROD_CHECKOUT" rev-parse HEAD 2>/dev/null; git -C "$PROD_CHECKOUT" status --porcelain 2>/dev/null | sha256sum | cut -c1-16; }

[ "$MODE" = pre ] || [ "$MODE" = post ] || { echo "usage: $0 pre | post <jobid>"; exit 2; }
need DUPV_BIN; need PROD_CHECKOUT
mkdir -p "$PILOT_DIR" && chmod 700 "$PILOT_DIR"

if [ "$MODE" = pre ]; then
  need EXPECT_SHA; need EXPECT_SHA256
  echo "== 1. Isolation from the scheduled chains"
  top=$(git -C "$CLONE" rev-parse --show-toplevel 2>/dev/null)
  prod=$(cd "$PROD_CHECKOUT" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
  [ -n "$prod" ] || fail "PROD_CHECKOUT is not a git checkout"
  [ -n "$top" ] && [ "$top" != "$prod" ] && pass "pilot runs from a separate clone (not the production checkout)" \
    || fail "pilot clone and production checkout are the same directory"
  case "$top/" in "$prod/"*) fail "pilot clone is inside the production checkout" ;; esac
  head=$(git -C "$CLONE" rev-parse HEAD)
  [[ "$head" == "$EXPECT_SHA"* ]] && pass "pilot clone is at the reviewed commit ${head:0:7}" \
    || fail "pilot clone is at ${head:0:7}, expected $EXPECT_SHA"
  [ -z "$(git -C "$CLONE" status --porcelain --untracked-files=no)" ] && pass "pilot clone has no local modifications" \
    || fail "pilot clone has local modifications"
  grep -qE '^\s*[^#]*\bsbatch\b' "$CLONE/scanner/scripts/dupverify_pilot.sh" \
    && fail "pilot script calls sbatch (it must not resubmit)" || pass "pilot script never resubmits itself"
  grep -q 'singleton' "$CLONE/scanner/scripts/dupverify_pilot.sh" \
    && fail "pilot script uses a singleton dependency" || pass "pilot script has no job dependencies"
  hdr_acct=$(grep -m1 -oE '^#SBATCH --account=[^ ]+' "$CLONE/scanner/scripts/dupverify_pilot.sh" | cut -d= -f2)
  hdr_part=$(grep -m1 -oE '^#SBATCH --partition=[^ ]+' "$CLONE/scanner/scripts/dupverify_pilot.sh" | cut -d= -f2)
  [ "$hdr_acct" = cil ] && [ "$hdr_part" = "$PARTITION" ] && pass "script header requests account cil, partition $PARTITION" \
    || fail "script header requests account '${hdr_acct}', partition '${hdr_part}'"
  for v in SBATCH_ACCOUNT SBATCH_PARTITION SLURM_ACCOUNT SLURM_PARTITION; do
    [ -n "${!v:-}" ] && warn "$v=${!v} is set in this shell; it would override the script header, so the sbatch command must pass --account=cil --partition=$PARTITION explicitly (the runbook does)"
  done
  jobs_snapshot > "$PILOT_DIR/pre-jobs.txt"; chmod 600 "$PILOT_DIR/pre-jobs.txt"
  prod_state > "$PILOT_DIR/pre-prod.txt"; chmod 600 "$PILOT_DIR/pre-prod.txt"
  echo "       your queued/running jobs (saved for the postflight comparison):"
  sed 's/^/         /' "$PILOT_DIR/pre-jobs.txt"
  awk -v n="$JOB_NAME" '$2 == n' "$PILOT_DIR/pre-jobs.txt" | grep -q . \
    && fail "a $JOB_NAME job is already queued; do not submit twice" || pass "no $JOB_NAME job already queued"
  chain_names=$(find "$PROD_CHECKOUT/scanner/scripts" -maxdepth 1 -name "*.sh" ! -name "dupverify_*" -exec grep -h -oE '^#SBATCH --job-name=[A-Za-z0-9_.-]+' {} + 2>/dev/null \
                | cut -d= -f2 | sort -u)
  grep -qx "$JOB_NAME" <<<"$chain_names" && fail "job name $JOB_NAME is used by a chain script" \
    || pass "job name $JOB_NAME differs from every chain job name ($(echo $chain_names | wc -w) checked)"
  soon=$(awk -v now="$(date +%s)" '$5 ~ /^20/ { cmd = "date -d " $5 " +%s"; cmd | getline t; close(cmd);
           if (t > now && t - now < 2700) print $2 " at " $5 }' "$PILOT_DIR/pre-jobs.txt")
  [ -z "$soon" ] && pass "no scheduled job of yours starts within the next 45 min" \
    || warn "scheduled job(s) start within 45 min: $soon (consider waiting until after them)"
  cpus=$(sinfo -p "$PARTITION" -h -o '%C' 2>/dev/null | head -1)   # allocated/idle/other/total
  idle=$(echo "$cpus" | cut -d/ -f2)
  [ -n "$idle" ] && [ "$idle" -ge 2 ] 2>/dev/null && pass "partition $PARTITION has $idle idle CPUs (pilot needs 2)" \
    || warn "partition $PARTITION idle CPUs: ${idle:-unknown}; the pilot may queue, which is harmless"

  echo "== 2. Private inputs and outputs"
  hm=$(mode_of "$HOME"); [ $(( 0$hm & 07 )) -eq 0 ] && pass "home directory is not world-accessible ($hm)" \
    || warn "home directory mode is $hm (others can traverse it; the pilot dirs below must be 700)"
  private_dir "$(dirname "$PILOT_DIR")" "~/dupverify"
  private_dir "$PILOT_DIR" "pilot directory"
  private_file "$CANDIDATES" "candidate file"
  [ "$(stat -c %U "$CANDIDATES" 2>/dev/null)" = "$USER" ] && pass "candidate file is owned by you" || fail "candidate file owner"
  sum=$(sha256sum "$CANDIDATES" 2>/dev/null | cut -d' ' -f1)
  [ "$sum" = "$EXPECT_SHA256" ] && pass "candidate file checksum matches the workstation export" \
    || fail "candidate file checksum differs from the workstation export"
  [ ! -e "$OUT" ] && pass "output directory does not exist yet (fresh run; it will be created 0700)" \
    || { [ -z "$(ls -A "$OUT")" ] && private_dir "$OUT" "output directory (empty)" \
         || fail "output directory already has content; use a new OUT for a fresh pilot"; }
  if [ -d "$CLONE/slurm_out" ]; then private_dir "$CLONE/slurm_out" "slurm_out"
  else fail "create the log directory first: mkdir -m 700 $CLONE/slurm_out"; fi
  [ "$(umask)" = 0077 ] && pass "shell umask is 077 (Slurm creates the job logs with it)" \
    || fail "run 'umask 077' in this shell before sbatch (current $(umask))"
  case "$CANDIDATES $OUT" in *"$PROD_CHECKOUT"*|*public_html*|*/project/*|*/scratch/*cil_scans*)
       fail "inputs/outputs must stay outside the production checkout, public_html and shared trees" ;;
     *) pass "inputs and outputs are outside the production checkout, public_html and shared trees" ;; esac

  echo "== 3. Binary and plan"
  [ -x "$DUPV_BIN" ] && pass "binary present: $("$DUPV_BIN" --version 2>&1)" || fail "binary missing: build it first"
  plan=$("$DUPV_BIN" --input "$CANDIDATES" --plan 2>&1)
  get() { python3 -c "import json,sys; print(json.loads(sys.argv[1])['$1'])" "$plan" 2>/dev/null; }
  [ "$(get groups)" = "$EXPECT_GROUPS" ] && pass "plan: $EXPECT_GROUPS groups" || fail "plan: groups=$(get groups), want $EXPECT_GROUPS"
  [ "$(get files)" = "$EXPECT_FILES" ] && pass "plan: $EXPECT_FILES files" || fail "plan: files=$(get files), want $EXPECT_FILES"
  [ "$(get sample_bytes_max)" = "$EXPECT_SAMPLE_BYTES" ] && pass "plan: sample stage at most $EXPECT_SAMPLE_BYTES bytes" \
    || fail "plan: sample_bytes_max=$(get sample_bytes_max), want $EXPECT_SAMPLE_BYTES"
  grep -q '/' <<<"$plan" && fail "plan output contains a path" || pass "plan output contains no paths"

  echo "== 4. Leak check of this preflight's own records"
  python3 "$SUMMARIZE" --leak-check "$PILOT_DIR/pre-jobs.txt" --candidates "$CANDIDATES" >/dev/null \
    && pass "saved job list holds no candidate paths or names" || fail "saved job list mentions candidate paths"
else
  [ -n "$JOBID" ] || { echo "usage: $0 post <jobid>"; exit 2; }
  LOG_OUT="$CLONE/slurm_out/dupverify_${JOBID}.out"; LOG_ERR="$CLONE/slurm_out/dupverify_${JOBID}.err"
  echo "== 1. Job outcome"
  sacct -j "$JOBID" -X -n -o JobID,JobName%16,Partition,Account,State,ExitCode,Elapsed,MaxRSS 2>/dev/null | sed 's/^/       /'
  ap=$(sacct -j "$JOBID" -X -n -P -o Account,Partition 2>/dev/null | head -1)
  [ "$ap" = "cil|$PARTITION" ] && pass "job ran under account cil on partition $PARTITION" \
    || fail "job ran under account|partition '$ap', expected cil|$PARTITION"
  state=$(sacct -j "$JOBID" -X -n -o State,ExitCode 2>/dev/null | head -1 | tr -s ' ')
  case "$state" in *COMPLETED*0:0*) pass "job completed" ;;
                   *FAILED*3:0*)    pass "job stopped at its budget or time limit (exit 3, resumable)" ;;
                   *) fail "unexpected job state: $state" ;; esac
  echo "== 2. No sensitive names in logs or job records"
  for f in "$LOG_OUT" "$LOG_ERR"; do private_file "$f" "$(basename "$f")"; done
  python3 "$SUMMARIZE" --leak-check "$LOG_OUT" "$LOG_ERR" --candidates "$CANDIDATES" > "$PILOT_DIR/leak-check.json"
  rc=$?; chmod 600 "$PILOT_DIR/leak-check.json"
  [ $rc = 0 ] && pass "job logs contain no candidate paths, directory or file names" \
    || fail "job logs mention candidate paths or names: see $PILOT_DIR/leak-check.json (counts only)"
  scontrol show job "$JOBID" 2>/dev/null | python3 "$SUMMARIZE" --leak-check /dev/stdin --candidates "$CANDIDATES" >/dev/null \
    && pass "Slurm job record holds no candidate paths" || warn "Slurm job record check unavailable or not clean (records expire after the job)"
  echo "== 3. Outputs"
  private_dir "$OUT" "output directory"
  for f in "$OUT"/*; do private_file "$f" "$(basename "$f")"; done
  python3 "$SUMMARIZE" --out "$OUT" --recheck > "$PILOT_DIR/summary-check.json"; chmod 600 "$PILOT_DIR/summary-check.json"
  python3 "$SUMMARIZE" --leak-check "$PILOT_DIR/summary-check.json" --candidates "$CANDIDATES" >/dev/null \
    && pass "summary report is counts only (safe to share)" || fail "summary report mentions candidate paths"
  python3 - "$PILOT_DIR/summary-check.json" "$EXPECT_GROUPS" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); want = int(sys.argv[2])
g = d["groups_by_latest_status"]; runs = d["runs"]
seen = sum(g.values()) + sum(r.get("groups_not_attempted") or 0 for r in runs[-1:])
ok = lambda c, m: print(("  PASS  " if c else "  FAIL  ") + m)
ok(seen == want, "all %d groups accounted for (%s)" % (want, g))
r = runs[-1] if runs else {}
ok((r.get("bytes_read") or 0) <= 5 * 2**30, "bytes read %.1f MiB <= 5 GiB budget" % ((r.get("bytes_read") or 0) / 2**20))
ok((r.get("read_mib_s") or 0) <= 25.5, "average read rate %.2f MiB/s <= 25" % (r.get("read_mib_s") or 0))
rc = d.get("recheck", {}).get("paths", {})
ok(set(rc) <= {"unchanged"}, "every verified path still the verified version (%s)" % rc)
print("  INFO  verified sets %d, copies %d, potential %.3f GiB; skip reasons %s; opened without O_NOATIME %s of %s"
      % (d["verified_sets"], d["verified_copies"], d["potential_logical_GiB"], d["skip_reasons"],
         r.get("opened_without_noatime"), r.get("files_opened")))
sys.exit(0 if seen == want else 1)
PY
  [ $? = 0 ] || FAILS=$((FAILS + 1))
  echo "== 4. Scheduled chains and production checkout untouched"
  [ "$(prod_state)" = "$(cat "$PILOT_DIR/pre-prod.txt" 2>/dev/null)" ] && pass "production checkout unchanged (same HEAD and status)" \
    || fail "production checkout differs from the preflight snapshot"
  gone=$(comm -23 <(awk '{print $1, $2}' "$PILOT_DIR/pre-jobs.txt" | sort) <(jobs_snapshot | awk '{print $1, $2}' | sort) \
         | grep -v " $JOB_NAME\$")
  [ -z "$gone" ] && pass "every job queued before the pilot is still queued" \
    || warn "jobs no longer queued since preflight (may simply have run on schedule): $gone"
fi
echo
[ "$FAILS" = 0 ] && echo "RESULT: no failures" || echo "RESULT: $FAILS failure(s)"
[ "$FAILS" = 0 ]
