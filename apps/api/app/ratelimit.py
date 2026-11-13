"""Per-client rate limits for expensive or sensitive endpoints.

In-process sliding window. The API runs as a single uvicorn worker, so the
counts are exact. Ordinary browsing (tree, voronoi, contents) is not
limited, to keep the dashboard responsive.

Client identity: behind the Cloudflare tunnel every request reaches the API
from the web container, so the peer address is useless. Cloudflare sets
CF-Connecting-IP at its edge (any client-supplied value is overwritten),
and the service ports are bound to 127.0.0.1, so that header is the
client key. Requests without it (local cron jobs) share one "local" bucket.
"""
import threading
import time
from collections import deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# (method or "*", path prefix) -> (max requests, window seconds). First match wins.
RULES: list[tuple[str, str, int, int]] = [
    ("POST", "/api/auth/validate", 10, 60),        # username enumeration
    ("POST", "/api/nl-to-sql", 10, 60),            # external LLM quota
    ("POST", "/api/query", 30, 60),                # up to 20 s of ClickHouse each
    ("GET", "/api/search", 60, 60),
    ("POST", "/api/feedback", 10, 60),
    ("DELETE", "/api/feedback", 20, 60),
    ("GET", "/api/housekeeping/operator", 20, 60),  # key verification
    ("POST", "/api/housekeeping/receipts", 10, 60),
    ("POST", "/api/housekeeping/candidates", 30, 60),
]


def client_key(request: Request) -> str:
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return "local"


class SlidingWindowLimiter:
    def __init__(self, clock=time.monotonic):
        self._hits: dict[tuple[str, str], deque] = {}
        self._lock = threading.Lock()
        self._clock = clock
        self._last_prune = clock()

    def check(self, bucket: str, client: str, limit: int, window: int) -> float | None:
        """Record a hit; return None if allowed, else seconds until retry."""
        now = self._clock()
        with self._lock:
            if now - self._last_prune > 300:
                self._prune(now)
            q = self._hits.setdefault((bucket, client), deque())
            while q and now - q[0] >= window:
                q.popleft()
            if len(q) >= limit:
                return max(0.0, window - (now - q[0]))
            q.append(now)
            return None

    def _prune(self, now: float) -> None:
        self._last_prune = now
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] > 3600]:
            del self._hits[key]


limiter = SlidingWindowLimiter()


def match_rule(method: str, path: str):
    for m, prefix, limit, window in RULES:
        if (m == "*" or m == method) and path.startswith(prefix):
            return f"{m} {prefix}", limit, window
    return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rule = match_rule(request.method.upper(), request.url.path)
        if rule:
            bucket, limit, window = rule
            retry = limiter.check(bucket, client_key(request), limit, window)
            if retry is not None:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests — please wait a moment and try again."},
                    headers={"Retry-After": str(int(retry) + 1)},
                )
        return await call_next(request)
