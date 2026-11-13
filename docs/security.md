# Security model

The dashboard deliberately has no login provider. Users type a username at
the gate and can browse. This page explains what that means, what the
system does to stay safe within that constraint, and what it cannot protect
against.

## Principles

1. **A username is a label, never a credential.** The `X-User` header is
   validated for format (`^[a-z0-9][a-z0-9._-]{0,31}$`) and recorded for
   attribution, but it never grants a capability.
2. **Browsing is read-only by construction.** Dashboard queries run as the
   ClickHouse account `tracker_api`, which has only `SELECT` on `filesystem.*`
   and `computing.*`. The raw SQL console is bounded by ClickHouse grants and
   a constrained settings profile, not by the regex guardrails (those only
   give friendlier errors).
3. **Privileged operations need a server-held secret.** Every housekeeping
   change needs `HK_OPERATOR_KEY` (header `X-Operator-Key`, constant-time
   compare). The guard is applied router-wide in
   `apps/api/app/security.py`, so new write routes are protected by default.
   Tests walk every registered route. If the key is unset, changes are
   disabled (fail closed).
4. **Secrets never travel back.** No endpoint returns a secret. The executor
   token stays on the cluster (`~/.hk_exec_token`). Scripts hand secrets to
   `curl`/`clickhouse-client` on stdin or through the environment, never as
   command-line arguments visible in `ps`.

## Credentials

| Secret (`.env`) | Used by | Grants |
|---|---|---|
| `HK_OPERATOR_KEY` | Operator's browser (Housekeeping → "unlock changes"), `backup-housekeeping.sh`, `ingest-computing.sh` | All housekeeping/recon writes, record exports, run-command, computing ingest |
| `HK_EXEC_TOKEN` | `hk-executor` on the cluster (`~/.hk_exec_token`) | Receipt upload only |
| `CLICKHOUSE_PASSWORD` | `default` admin account: importer, maintenance scripts | Everything; reachable only from this host and the compose network |
| `CLICKHOUSE_API_PASSWORD` | API as `tracker_api` | `SELECT` on `filesystem.*`, `computing.*`; pinned limits |
| `CLICKHOUSE_INGEST_PASSWORD` | API ingest as `tracker_ingest` | `SELECT`, `INSERT` on `computing.*` |
| `POSTGRES_PASSWORD` | API → Postgres (not published) | Housekeeping database |

Generate every value with `openssl rand -hex 32` (hex only: the scripts embed
these values in curl config and SQL literals).

## What is mitigated

| Risk | Control |
|---|---|
| Typing someone else's username to change housekeeping state, delete feedback, or upload receipts | Operator key / per-comment delete token / executor token; username ignored for authorization |
| Executor token disclosure | `/manifests/{id}/command` no longer contains it; operator-only |
| Writes, DDL, `SYSTEM`, table functions (`url`, `file`, `remote`, `executable`, …), reading `system.*`, raising query limits from the SQL console | `tracker_api` grants and settings profile with constraints (verified against ClickHouse 24.1) |
| Database or API reachable from the LAN | All published ports bound to `127.0.0.1`; public traffic only via the Cloudflare tunnel to the web app |
| Shell/markup injection through file names | Tooltip built with `textContent`; restore commands POSIX-quoted (`mkdir -p` + `mv -n`) |
| Wildcards in directory names (`_`, `%`) widening a deletion target | Literal `startsWith` prefix matching everywhere |
| Executing a withdrawn verdict | Manifests refuse superseded decisions (409) |
| Linter `eval()` hang, gzip bombs, oversized uploads | Bounded integer parser; capped upload and decompressed sizes |
| Brute force, enumeration, LLM-quota abuse | Per-client rate limits on login, SQL, NL-to-SQL, search, feedback, key checks, receipts |
| Internals in error messages | 500s return a reference id; details only in the server log |
| Forged scan data or login allowlist over the network | RCC fetches use verified TLS, or the pinned server key while RCC's certificate is expired; never `-k` |
| Silent backup failure | Hourly backup fixed; weekly restore check fails on stale or empty dumps |

CSRF: no cookies or ambient credentials exist. Privileged calls carry an
explicit header secret that a cross-site page cannot read, and CORS does not
allow credentials.

## What remains (unavoidable without real authentication)

- **Everything readable is readable by anyone who reaches the URL.** That
  includes full paths, owners, sizes and ages; the read-only SQL console;
  housekeeping reports, recon, people, events and manifest file lists.
  Only a network-level gate (e.g. a Cloudflare Access policy) or real login
  changes this.
- **Usernames can be enumerated** at the login gate (rate-limited, not
  preventable while the gate says "not recognized").
- **Audit attribution is unverified.** Housekeeping events record the
  username the operator's browser claims. The operator key proves "someone
  holding the key", not who.
- **The operator key is a shared bearer secret** kept in browser
  `localStorage`. Anyone who obtains it (shared machine, malware, a future XSS
  bug) has full housekeeping power until it is rotated. There is no
  per-person accountability or revocation.
- **Rate limits are best-effort.** They are in-memory, reset on restart, and
  keyed on `CF-Connecting-IP` (trusted because Cloudflare sets it at its edge
  and the ports are bound to localhost).
- **NL-to-SQL sends questions (and failed SQL) to Groq.**
- **The scans themselves are world-readable on RCC** (`public_html`), which
  exposes more than the dashboard does. That is outside this application.
- **The RCC TLS pin is trust-on-first-use** (recorded 2026-11-13). If RCC
  rotates the key without fixing the certificate, fetches fail closed until
  the pin is updated (`RCC_TLS_PIN`).

## Known follow-ups

- Bind the verdict/action into the signed manifest so `--purge` cannot run a
  quarantine decision; compare inodes and walk with `O_NOFOLLOW` in
  `hk-executor`.
- Content-Security-Policy header for the web app.
- Move blocking ClickHouse calls out of `async def` handlers.

## Enabling the hardened configuration

Code alone changes nothing on a running stack. Until `.env` is updated and
the containers are recreated, the old configuration stays in effect.

1. **Tag the current images for rollback:**
   `for s in api web; do docker tag dev-tracker-app-$s:latest dev-tracker-app-$s:pre-security; done`
2. **Add to `.env`** (new random values):
   `HK_OPERATOR_KEY`, `CLICKHOUSE_API_PASSWORD`, `CLICKHOUSE_INGEST_PASSWORD`,
   then `CLICKHOUSE_API_USER=tracker_api`, `CLICKHOUSE_INGEST_USER=tracker_ingest`,
   `CLICKHOUSE_SESSION_READONLY=false`. Rotate `HK_EXEC_TOKEN` (it was
   exposed) and write the new value to `~/.hk_exec_token` (mode 600) on
   Midway.
3. **Create the ClickHouse accounts** (no downtime):
   `./scripts/setup-clickhouse-users.sh`
4. **Rebuild and recreate** (brief downtime; data volumes are untouched):
   `docker compose build api web && docker compose up -d clickhouse api web`
5. **Verify:** `ss -ltn` lists 3000/8000/8123/9000 on `127.0.0.1` only;
   `curl -s localhost:8000/health`; unlocking changes in the Housekeeping tab
   works; `./scripts/ingest-computing.sh` returns OK;
   `./scripts/backup-housekeeping.sh` uploads the record export; a write
   without the key returns 403.

**Rollback:** `git checkout <previous-commit> -- docker-compose.yml`, retag
the `:pre-security` images as `:latest`, remove the new keys from `.env` (or
leave them; unused keys are harmless), and run `docker compose up -d`. The
ClickHouse accounts can stay; nothing uses them after rollback.
