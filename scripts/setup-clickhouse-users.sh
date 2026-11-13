#!/bin/bash
# =============================================================================
# setup-clickhouse-users.sh — least-privilege ClickHouse accounts for the API
#
# Creates (or resets) two accounts. Re-running is safe; each run re-applies
# the exact grants below:
#
#   tracker_api     SELECT on filesystem.* and computing.* only. Used for
#                   every dashboard query, including the raw SQL console.
#                   Server-side limits come from a settings profile with
#                   constraints, so a client cannot raise them. No table
#                   functions (url/file/remote/...), DDL, DML or SYSTEM.
#   tracker_ingest  INSERT + SELECT on computing.* only, for the daily
#                   /api/computing/ingest job.
#
# The admin `default` account stays for the importer and maintenance
# scripts. With the compose ports bound to 127.0.0.1 it is reachable only
# from this host and the compose network.
#
# Passwords come from .env (CLICKHOUSE_API_PASSWORD,
# CLICKHOUSE_INGEST_PASSWORD) and reach clickhouse-client on stdin, never
# on the command line. ClickHouse stores only their SHA-256 hash.
#
# Usage:  ./scripts/setup-clickhouse-users.sh
#   CH_EXEC overrides the client command (used by tests against a scratch
#   container), e.g. CH_EXEC="docker exec -i ch-test clickhouse-client".
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env}"
cd "$PROJECT_ROOT"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

for var in CLICKHOUSE_API_PASSWORD CLICKHOUSE_INGEST_PASSWORD; do
  val="${!var:-}"
  if [ -z "$val" ]; then
    echo "ERROR: $var is not set (add it to $ENV_FILE; e.g. openssl rand -hex 32)"; exit 1
  fi
  # Keep the SQL literal trivially safe: no quotes or backslashes possible.
  if ! [[ "$val" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
    echo "ERROR: $var must be at least 16 characters of [A-Za-z0-9_-]"; exit 1
  fi
done

# Docker compose networks are allocated from 172.16.0.0/12 by default.
API_HOSTS="${CH_API_HOSTS:-IP '127.0.0.1', IP '::1', IP '172.16.0.0/12'}"
MAX_EXEC="${MAX_EXECUTION_TIME:-20}"
MAX_ROWS="${MAX_RESULT_ROWS:-8000}"
MAX_BYTES="${MAX_RESULT_BYTES:-80000000}"
MAX_MEM="${CH_API_MAX_MEMORY:-8000000000}"

CH_EXEC="${CH_EXEC:-docker compose exec -T clickhouse clickhouse-client}"

$CH_EXEC --multiquery <<SQL
CREATE SETTINGS PROFILE OR REPLACE tracker_api_profile SETTINGS
    readonly = 2,
    max_execution_time = ${MAX_EXEC} MAX ${MAX_EXEC},
    max_result_rows = ${MAX_ROWS} MAX ${MAX_ROWS},
    max_result_bytes = ${MAX_BYTES} MAX ${MAX_BYTES},
    max_memory_usage = ${MAX_MEM} MAX ${MAX_MEM},
    allow_ddl = 0 CONST,
    allow_introspection_functions = 0 CONST;

CREATE USER OR REPLACE tracker_api
    IDENTIFIED WITH sha256_password BY '${CLICKHOUSE_API_PASSWORD}'
    HOST ${API_HOSTS}
    SETTINGS PROFILE tracker_api_profile;
GRANT SELECT ON filesystem.* TO tracker_api;
GRANT SELECT ON computing.* TO tracker_api;

CREATE USER OR REPLACE tracker_ingest
    IDENTIFIED WITH sha256_password BY '${CLICKHOUSE_INGEST_PASSWORD}'
    HOST ${API_HOSTS};
GRANT SELECT, INSERT ON computing.* TO tracker_ingest;
SQL

echo "ClickHouse users ready: tracker_api (read-only), tracker_ingest (computing inserts)."
