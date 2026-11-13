"""Server-side access controls for the username-gated dashboard.

The dashboard has no real authentication: anyone can type any username at
the login gate. A username (and the X-User header carrying it) is therefore
only a display / attribution label. It is never proof of identity and
never grants a capability.

Privileged operations are protected independently of that flow by
server-held secrets, compared in constant time:

- HK_OPERATOR_KEY — required for every state-changing housekeeping / recon /
  ingest request and for the full-record exports. Sent as X-Operator-Key.
  When the variable is unset, those operations are disabled (fail closed).
- HK_EXEC_TOKEN   — accepted only for executor receipt uploads
  (X-Exec-Token), so the token kept on the cluster cannot do anything else.
"""
import hmac
import os
import re

from fastapi import HTTPException, Request

# RCC/CNetIDs and the ALLOWED_USERS extras: lowercase, short, no spaces.
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,31}$")

OPERATOR_HEADER = "x-operator-key"
EXEC_TOKEN_HEADER = "x-exec-token"


def normalize_username(raw: str | None) -> str | None:
    """Return the canonical username, or None if absent/invalid."""
    if raw is None:
        return None
    name = raw.strip().lower()
    return name if USERNAME_RE.fullmatch(name) else None


def _secret_matches(supplied: str | None, env_var: str) -> bool:
    expected = os.environ.get(env_var, "")
    if not expected or not supplied:
        return False
    return hmac.compare_digest(supplied.encode(), expected.encode())


def operator_configured() -> bool:
    return bool(os.environ.get("HK_OPERATOR_KEY", ""))


def is_operator(request: Request) -> bool:
    return _secret_matches(request.headers.get(OPERATOR_HEADER), "HK_OPERATOR_KEY")


def is_executor(request: Request) -> bool:
    return _secret_matches(request.headers.get(EXEC_TOKEN_HEADER), "HK_EXEC_TOKEN")


def _deny_unless_operator(request: Request) -> None:
    if is_operator(request):
        return
    if not operator_configured():
        raise HTTPException(status_code=503, detail=(
            "Housekeeping changes are disabled: no operator key is configured "
            "on the server (HK_OPERATOR_KEY)."))
    raise HTTPException(status_code=403, detail=(
        "This action changes housekeeping state and needs the operator key. "
        "Unlock changes in the Housekeeping tab."))


def require_operator(request: Request) -> None:
    """Route dependency: operator key required."""
    _deny_unless_operator(request)


# Housekeeping/recon routes that use POST but only read (query bodies too
# large for a URL). Everything else that is not GET/HEAD needs the key.
READ_ONLY_POSTS = frozenset({
    "/api/housekeeping/candidates/find",
    "/api/housekeeping/candidates/sample",
})

# GETs that expose more than the dashboard already shows: the complete
# housekeeping record (all notes and decisions) and the executor command.
OPERATOR_GETS = frozenset({
    "/api/housekeeping/archive.json",
    "/api/housekeeping/archive.csv",
    "/api/housekeeping/manifests/{manifest_id}/command",
})

EXECUTOR_ROUTES = frozenset({
    "/api/housekeeping/receipts",
})


def housekeeping_guard(request: Request) -> None:
    """Router-level dependency for /api/housekeeping (and /recon).

    Safe by default: a new write route is protected without remembering to
    add anything. Decides on the matched route template, not the raw URL.
    """
    route = request.scope.get("route")
    template = getattr(route, "path", request.url.path)
    method = request.method.upper()

    if template in EXECUTOR_ROUTES and (is_executor(request) or is_operator(request)):
        return
    if template in EXECUTOR_ROUTES and request.headers.get(EXEC_TOKEN_HEADER):
        raise HTTPException(status_code=401, detail=(
            "invalid executor token — check ~/.hk_exec_token on the cluster "
            "matches HK_EXEC_TOKEN on the server"))
    if method in ("GET", "HEAD", "OPTIONS"):
        if template in OPERATOR_GETS:
            _deny_unless_operator(request)
        return
    if method == "POST" and template in READ_ONLY_POSTS:
        return
    _deny_unless_operator(request)
