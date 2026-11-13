#!/bin/bash
# End-to-end check of the duplicate-verification workflow on synthetic data:
# ClickHouse export -> cil-dupverify -> import -> query.
# Uses a throwaway ClickHouse container (no published ports) and a temp dir;
# never touches the production stack.
#
#   bash scripts/tests/dupverify_e2e_test.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${CH_TEST_IMAGE:-clickhouse/clickhouse-server:24.1}"
C="dupverify-ch-test-$$"
T="$(mktemp -d)"
cleanup() { docker rm -f "$C" >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT
FAIL=0; PASS=0
exec </dev/null  # docker exec -i must never wait on an inherited stdin
check() { if eval "$2"; then PASS=$((PASS + 1)); echo "  ok   $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1"; fi; }

(cd "$REPO/scanner" && cargo build -q -p dupverify) || { echo "build failed"; exit 1; }
BIN="$REPO/scanner/target/debug/cil-dupverify"

docker run -d --name "$C" --ulimit nofile=262144:262144 "$IMAGE" >/dev/null || exit 1
for _ in $(seq 60); do docker exec "$C" clickhouse-client -q "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done
export CH_EXEC="docker exec -i $C clickhouse-client"
$CH_EXEC --multiquery < "$REPO/clickhouse/schema/01_create_tables.sql" >/dev/null 2>&1 || true
$CH_EXEC -q "EXISTS TABLE filesystem.entries" | grep -q 1 || { echo "entries table not created"; exit 1; }
$CH_EXEC --multiquery < "$REPO/clickhouse/schema/06_duplicate_verification.sql" || exit 1

# Synthetic tree: identical content under different names, same name and
# size with different content, a hard link, a symlink, a 10-copy group,
# a small file below --min-size and an unrelated singleton.
python3 - "$T" <<'PY' > "$T/entries.jsonl"
import json, os, sys
t = sys.argv[1]; d = os.path.join(t, "data")
def w(rel, data):
    p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(data); return p
blob = lambda seed, n: bytes((i * 31 + seed) % 251 for i in range(n))
paths = [w("lab1/run_a.nc", blob(1, 3 << 20)), w("lab2/renamed.bin", blob(1, 3 << 20)),
         w("lab1/x/out.dat", blob(2, 2 << 20)), w("lab2/x/out.dat", blob(3, 2 << 20)),
         w("lab3/single.bin", blob(9, 5 << 20)), w("lab3/small_a", blob(4, 1000)), w("lab3/small_b", blob(4, 1000))]
os.link(paths[0], os.path.join(d, "lab1/hardlink.nc")); paths.append(os.path.join(d, "lab1/hardlink.nc"))
os.symlink(paths[1], os.path.join(d, "lab2/sym.bin")); paths.append(os.path.join(d, "lab2/sym.bin"))
for i in range(10):
    paths.append(w(f"rep/copy_{i}", blob(7, (1 << 20) + 17)))
for p in paths:
    st = os.lstat(p); size = os.stat(p).st_size  # the scanner followed symlinks
    print(json.dumps({"snapshot_date": "2026-01-05", "path": p, "parent_path": os.path.dirname(p),
                      "name": os.path.basename(p), "depth": p.count("/"), "top_level_dir": "data",
                      "size": size, "file_type": "bin", "is_directory": 0, "modified_time": int(st.st_mtime),
                      "accessed_time": 0, "created_time": 0, "inode": st.st_ino, "permissions": 420,
                      "owner": "user_a", "group_name": "grp", "uid": 1000, "gid": 1000}))
PY
$CH_EXEC -q "INSERT INTO filesystem.entries FORMAT JSONEachRow" < "$T/entries.jsonl" || exit 1

out=$(python3 "$REPO/scripts/dupverify/export_candidates.py" --date 2026-01-05 --min-size 1M \
      --out "$T/cand.jsonl" 2>&1); rc=$?
check "export exits 0" '[ $rc = 0 ]'
check "export: 3 size groups (3M, 2M, 1M+17 x10; singleton and small files excluded)" \
  '[ "$(wc -l < "$T/cand.jsonl")" = 3 ]'
check "export: candidate files are private (0600)" '[ "$(stat -c %a "$T/cand.jsonl")" = 600 ]'
check "export: stdout carries no paths" '! grep -q "$T" <<<"$out"'
check "export: highest potential first" \
  '[ "$(head -1 "$T/cand.jsonl" | python3 -c "import json,sys; print(json.load(sys.stdin)[\"size\"])")" = $(( (1<<20) + 17 )) ]'
out=$(python3 "$REPO/scripts/dupverify/export_candidates.py" --date 2026-01-05 --min-size 1M \
      --prefix "$T/data/lab1" --out "$T/cand_lab1.jsonl" 2>&1)
check "export: --prefix scopes groups (lab1 only has the 3M link pair)" '[ "$(wc -l < "$T/cand_lab1.jsonl")" = 1 ]'

"$BIN" --settle-secs 0 --input "$T/cand.jsonl" --out "$T/run" --quiet --max-read-mib-s 0 > "$T/summary.json"; rc=$?
check "verify exits 0" '[ $rc = 0 ]'
py() { python3 -c "import json; s=json.load(open('$T/summary.json')); print($1)"; }
check "verify: 2 verified sets (renamed copy, 10 replicas)" '[ "$(py "s[\"duplicate_sets\"]")" = 2 ]'
check "verify: same name + size, different content is not a set" '[ "$(py "s[\"groups_complete\"]")" = 3 ]'
check "verify: hard link and symlink accounted for" \
  '[ "$(py "s[\"hardlink_paths\"]")" = 1 ] && [ "$(py "s[\"skipped_by_reason\"].get(\"symlink\",0)")" = 1 ]'
check "verify: savings = 3M + 9 x (1M+17)" \
  '[ "$(py "s[\"verified_logical_bytes\"]")" = $(( (3<<20) + 9 * ((1<<20) + 17) )) ]'

# Offline inspection (no database): counts, live recheck, independent byte check.
sumj=$(python3 "$REPO/scripts/dupverify/summarize_results.py" --out "$T/run" --recheck --spot-check 2)
sj() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($1)" "$sumj"; }
check "summary: 2 sets, counts only (no paths)" '[ "$(sj "d[\"verified_sets\"]")" = 2 ] && ! grep -q "$T/data" <<<"$sumj"'
check "summary: recheck finds all 13 verified paths unchanged" '[ "$(sj "d[\"recheck\"][\"paths\"].get(\"unchanged\")")" = 13 ]'
check "summary: independent byte check agrees on both sets" '[ "$(sj "d[\"spot_check\"].get(\"identical\")")" = 2 ]'
check "summary: outputs private" '[ "$(sj "d[\"file_modes\"][\"results.jsonl\"]")" = 0o600 ]'

out=$(python3 "$REPO/scripts/dupverify/import_results.py" --out "$T/run" 2>&1); rc=$?
check "import exits 0" '[ $rc = 0 ]'
check "import: 13 verified paths (2 + link + 10)" \
  '[ "$($CH_EXEC -q "SELECT count() FROM filesystem.dupverify_files")" = 13 ]'
check "import: group statuses stored" \
  '[ "$($CH_EXEC -q "SELECT count() FROM filesystem.dupverify_groups WHERE status = '"'"'complete'"'"'")" = 3 ]'
check "import: skipped symlink recorded" \
  '[ "$($CH_EXEC -q "SELECT reason FROM filesystem.dupverify_skipped")" = symlink ]'
out=$(python3 "$REPO/scripts/dupverify/import_results.py" --out "$T/run" 2>&1)
check "re-import is a no-op" 'grep -q "\"runs_already_imported\": 1" <<<"$out" && [ "$($CH_EXEC -q "SELECT count() FROM filesystem.dupverify_files")" = 13 ]'
check "import: run row carries totals" \
  '[ "$($CH_EXEC -q "SELECT duplicate_sets FROM filesystem.dupverify_runs")" = 2 ]'

# A verified file rewritten afterwards (same bytes) is reported as changed by the recheck.
cp -p "$T/data/rep/copy_3" "$T/x" && cat "$T/x" > "$T/data/rep/copy_3" && rm "$T/x"
sumj=$(python3 "$REPO/scripts/dupverify/summarize_results.py" --out "$T/run" --recheck)
check "recheck flags a file changed after verification" \
  '[ "$(sj "d[\"recheck\"][\"paths\"].get(\"changed\")")" = 1 ] && [ "$(sj "d[\"recheck\"][\"sets_all_unchanged\"]")" = 1 ]'

# A second, separate scope that stops on its budget: recorded, never verified.
python3 "$REPO/scripts/dupverify/export_candidates.py" --date 2026-01-05 --min-size 2M --max-size 2M \
  --out "$T/cand2.jsonl" >/dev/null
"$BIN" --settle-secs 0 --input "$T/cand2.jsonl" --out "$T/run2" --quiet --max-read-mib-s 0 --budget-gib 0.000001 \
  --sample-kib 1 --samples 1 > /dev/null; rc=$?
check "budget-stopped run exits 3 (resumable)" '[ $rc = 3 ]'
python3 "$REPO/scripts/dupverify/import_results.py" --out "$T/run2" >/dev/null

# API queries (the router's own SQL) against the scratch server.
API_PY="$REPO/apps/api/venv/bin/python"
if [ -x "$API_PY" ]; then
  $CH_EXEC -q "CREATE TABLE IF NOT EXISTS filesystem.snapshots (snapshot_date Date) ENGINE = MergeTree ORDER BY snapshot_date" </dev/null 2>/dev/null
  $CH_EXEC -q "INSERT INTO filesystem.snapshots (snapshot_date) VALUES ('2026-01-05')" </dev/null 2>/dev/null
  IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$C")
  # A newer snapshot in which the rewritten replica has a new mtime.
  NEWM=$(stat -c %Y "$T/data/rep/copy_3")
  python3 - "$T/entries.jsonl" "$T/data/rep/copy_3" "$NEWM" <<'PY' > "$T/entries2.jsonl"
import json, sys
src, changed, newm = sys.argv[1], sys.argv[2], int(sys.argv[3])
for line in open(src):
    r = json.loads(line); r["snapshot_date"] = "2026-01-12"
    if r["path"] == changed:
        r["modified_time"] = newm
    print(json.dumps(r))
PY
  $CH_EXEC -q "INSERT INTO filesystem.entries FORMAT JSONEachRow" < "$T/entries2.jsonl"
  $CH_EXEC -q "INSERT INTO filesystem.snapshots (snapshot_date) VALUES ('2026-01-12')" </dev/null 2>/dev/null
  api=$(cd "$REPO/apps/api" && CH_IP="$IP" ROOT_DIR="$T/data" "$API_PY" - <<'PY'
import json, os
from clickhouse_driver import Client
from app.routers import dupverify as dv
c = Client(host=os.environ["CH_IP"], port=9000, user="default", database="filesystem")
root = os.environ["ROOT_DIR"]
sets = dv.verified_sets(root, 1, 100, c)
st = dv.status_summary(root, c)
inc = dv.pending_groups(root, "incomplete", 100, c)
lab1 = dv.verified_sets(root + "/lab1", 1, 100, c)
chk = dv.snapshot_checks([(x["group_id"], x["blake3"]) for x in sets], "2026-01-12", c)
old = dv.snapshot_checks([(x["group_id"], x["blake3"]) for x in sets], "2026-01-05", c)
states = sorted((v["files"], v["state"], v["changed"]) for v in chk.values())
old_states = sorted(v["state"] for v in old.values())
print(json.dumps({
    "available": dv.available(c), "n_sets": len(sets), "copies": sorted(s["copies"] for s in sets),
    "top_logical": sets[0]["potential_logical_bytes"] if sets else None,
    "link_paths": max(len(s["files"]) for s in sets) if sets else 0,
    "status_complete": st["groups"].get("complete", {}).get("groups"),
    "status_incomplete": st["groups"].get("incomplete", {}).get("groups"),
    "verified_sets": st["verified"]["sets"], "runs": len(st["runs"]),
    "incomplete_rows": len(inc), "incomplete_reason": list(inc[0]["skip_reasons"]) if inc else [],
    "snap_states": states, "old_snap_states": old_states,
    "lab1_sets": len(lab1), "lab1_in_root": sorted(f["in_root"] for f in lab1[0]["files"]) if lab1 else [],
}))
PY
)
  echo "    api: $api"
  j() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($1)" "$api"; }
  check "api: tables detected" '[ "$(j "d[\"available\"]")" = True ]'
  check "api: two verified sets, 2 and 10 copies" '[ "$(j "d[\"copies\"]")" = "[2, 10]" ]'
  check "api: largest potential first (9 x (1M+17))" '[ "$(j "d[\"top_logical\"]")" = $(( 9 * ((1<<20) + 17) )) ]'
  check "api: status counts complete=3, incomplete=1, runs=2" \
    '[ "$(j "(d[\"status_complete\"], d[\"status_incomplete\"], d[\"runs\"])")" = "(3, 1, 2)" ]'
  check "api: incomplete group listed with budget reason" \
    '[ "$(j "d[\"incomplete_rows\"]")" = 1 ] && [ "$(j "d[\"incomplete_reason\"]")" = "['"'"'budget_exhausted'"'"']" ]'
  check "api: newer snapshot flags the set with the rewritten replica" \
    '[ "$(j "d[\"snap_states\"]")" = "[[3, '"'"'consistent'"'"', 0], [10, '"'"'needs_reverification'"'"', 1]]" ]'
  check "api: against the verified snapshot both sets are consistent" \
    '[ "$(j "d[\"old_snap_states\"]")" = "['"'"'consistent'"'"', '"'"'consistent'"'"']" ]'
  check "api: root scoping keeps sets touching the root, flags out-of-root copies" \
    '[ "$(j "d[\"lab1_sets\"]")" = 1 ] && [ "$(j "d[\"lab1_in_root\"]")" = "[False, True, True]" ]'
else
  echo "  skip API checks (apps/api/venv missing)"
fi

echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
