#!/bin/bash
# docker-import.sh `date` mode must touch only the requested snapshot date.
# Runs in DRY_RUN mode against a fake cil_scans/ tree; no Docker needed.
#
#   bash scripts/tests/import_scope_test.sh
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
FAIL=0; PASS=0
check() { if eval "$2"; then PASS=$((PASS + 1)); echo "  ok   $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1"; fi; }

for d in 2026-09-24 2026-11-13 2026-11-20; do
  for s in gcp home_dirs; do mkdir -p "$T/cil_scans/$s/$d"; touch "$T/cil_scans/$s/$d/${s}_${d}_chunk_0001.parquet"; done
done
mkdir -p "$T/cil_scans/coastal/2026-11-13"   # a source dir without parquet files

out=$(cd "$T" && DRY_RUN=1 bash "$REPO/scripts/docker-import.sh" date 2026-11-13 2>&1); rc=$?
check "exits 0" '[ $rc = 0 ]'
check "imports both sources of the date" '[ "$(grep -c "import_snapshot.py /scans/.*/2026-11-13" <<<"$out")" = 2 ]'
check "first source clears, the rest append" 'grep -q "home_dirs/2026-11-13 --no-clear" <<<"$out" && ! grep -q "gcp/2026-11-13 --no-clear" <<<"$out"'
check "never touches other dates" '! grep -qE "2026-09-24|2026-11-20" <<<"$out"'
n_part=$(grep -c "PARTITION ID .202611." <<<"$out")
n_whole=$(grep -cE "OPTIMIZE TABLE [a-z_.]+ FINAL" <<<"$out")
check "optimizes only the date's partition (2 scoped, 0 whole-table)" '[ "$n_part" = 2 ] && [ "$n_whole" = 0 ]'
check "skips a source directory without parquet files" 'grep -q "\[skip\] coastal/2026-11-13" <<<"$out"'
out=$(cd "$T" && DRY_RUN=1 bash "$REPO/scripts/docker-import.sh" date 13-11-2026 2>&1); rc=$?
check "rejects a malformed date" '[ $rc = 1 ] && grep -q Usage <<<"$out"'

echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
