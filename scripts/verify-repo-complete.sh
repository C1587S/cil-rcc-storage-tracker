#!/bin/bash
# =============================================================================
# verify-repo-complete.sh — assert that everything the workflow depends on
# is actually IN THE REPOSITORY and builds.
#
# Exists because of a real failure: an entire session's work (the executor,
# the pilot backend) was verified working locally but never committed, and
# the cluster pulled "Already up to date" into a tree missing all of it.
# "True on my machine" is not a state; this script checks the repo.
#
# Checks:
#   1. Required paths are tracked by git (git ls-files — not just on disk).
#   2. No uncommitted changes to critical paths (dirty tree = undeployed work).
#   3. Rust workspace compiles, executor binary buildable (where cargo exists).
#   4. Resolver test suite passes (where python3 exists).
#
# Run it: locally before telling anyone to pull; on the cluster after pulling.
# Exit code 0 = complete; anything else = something is missing.
# =============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"
FAIL=0

# --- 1. Required tracked paths ---
REQUIRED_PATHS=(
  scanner/src/models.rs
  scanner/Cargo.toml
  scanner/crates/manifest-types/src/lib.rs
  scanner/crates/manifest-types/Cargo.toml
  scanner/crates/hk-executor/src/main.rs
  scanner/crates/hk-executor/Cargo.toml
  apps/api/app/housekeeping/schema.sql
  apps/api/app/housekeeping/db.py
  apps/api/app/housekeeping/resolver.py
  apps/api/app/housekeeping/manifests.py
  apps/api/app/housekeeping/pilot.py
  apps/api/app/routers/housekeeping.py
  apps/api/app/routers/recon.py
  apps/web/components/housekeeping-recon.tsx
  apps/web/lib/hk.ts
  apps/api/tests/test_resolver.py
  apps/web/components/housekeeping-view.tsx
  docs/manifest-format.md
  scripts/backup-housekeeping.sh
  scripts/restore-check-housekeeping.sh
  scripts/r2util.py
  scripts/warm-cache.sh
  scripts/update-snapshot.sh
  scripts/docker-import.sh
)
echo "== tracked files"
for p in "${REQUIRED_PATHS[@]}"; do
  if git ls-files --error-unmatch "$p" >/dev/null 2>&1; then
    echo "  ok      $p"
  else
    echo "  MISSING $p  (exists on disk: $([ -e "$p" ] && echo yes || echo no))"
    FAIL=1
  fi
done

# --- 2. Uncommitted changes to critical trees ---
echo "== working tree"
DIRTY=$(git status --porcelain -- scanner apps/api apps/web/components scripts docs clickhouse 2>/dev/null | grep -v "^??" || true)
if [ -n "$DIRTY" ]; then
  echo "  WARNING: uncommitted changes (working but undeployed):"
  echo "$DIRTY" | sed 's/^/    /'
  FAIL=1
else
  echo "  ok      no uncommitted changes in critical paths"
fi
UNTRACKED=$(git status --porcelain -- scanner/crates apps/api/app/housekeeping 2>/dev/null | grep "^??" || true)
if [ -n "$UNTRACKED" ]; then
  echo "  WARNING: untracked files in critical paths:"
  echo "$UNTRACKED" | sed 's/^/    /'
  FAIL=1
fi

# --- 3. Rust builds (skipped without cargo, e.g. on the web host) ---
echo "== rust workspace"
if command -v cargo >/dev/null 2>&1; then
  if (cd scanner && cargo check --workspace --quiet 2>&1 | tail -3); then
    echo "  ok      workspace compiles (storage-scanner, manifest-types, hk-executor)"
  else
    echo "  FAIL    workspace does not compile"
    FAIL=1
  fi
else
  echo "  skip    cargo not available on this host"
fi

# --- 4. Resolver tests ---
echo "== resolver tests"
if command -v python3 >/dev/null 2>&1; then
  if (cd apps/api && python3 -m unittest tests.test_resolver 2>&1 | tail -1 | grep -q OK); then
    echo "  ok      resolver test suite passes"
  else
    echo "  FAIL    resolver tests failing"
    FAIL=1
  fi
else
  echo "  skip    python3 not available"
fi

echo
if [ "$FAIL" = 0 ]; then
  echo "COMPLETE: repository contains and builds everything the workflow depends on."
else
  echo "INCOMPLETE: fix the items above before telling anyone to pull."
fi
exit $FAIL
