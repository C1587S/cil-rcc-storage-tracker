"""Rate limits, docs exposure, CORS and error leakage.

Run from apps/api: python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app import ratelimit  # noqa: E402
from app.main import app  # noqa: E402


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class TestSlidingWindow(unittest.TestCase):
    def test_limit_then_recover(self):
        clock = FakeClock()
        lim = ratelimit.SlidingWindowLimiter(clock=clock)
        for _ in range(3):
            self.assertIsNone(lim.check("b", "1.2.3.4", 3, 60))
        retry = lim.check("b", "1.2.3.4", 3, 60)
        self.assertIsNotNone(retry)
        self.assertIsNone(lim.check("b", "5.6.7.8", 3, 60))  # other clients unaffected
        clock.t += 61
        self.assertIsNone(lim.check("b", "1.2.3.4", 3, 60))


class TestMiddleware(unittest.TestCase):
    def setUp(self):
        self._lim = mock.patch.object(ratelimit, "limiter", ratelimit.SlidingWindowLimiter())
        self._lim.start()
        self.c = TestClient(app)

    def tearDown(self):
        self._lim.stop()

    def test_login_endpoint_is_limited_per_client(self):
        hdr = {"CF-Connecting-IP": "203.0.113.9"}
        with mock.patch("app.routers.auth._fetch_group_members", return_value=[]):
            codes = [self.c.post("/api/auth/validate", json={"username": "nobody"}, headers=hdr).status_code
                     for _ in range(12)]
            self.assertEqual(codes[:10], [403] * 10)
            self.assertEqual(codes[10:], [429, 429])
            other = self.c.post("/api/auth/validate", json={"username": "nobody"},
                                headers={"CF-Connecting-IP": "203.0.113.10"})
            self.assertEqual(other.status_code, 403)

    def test_429_has_retry_after(self):
        hdr = {"CF-Connecting-IP": "203.0.113.11"}
        with mock.patch("app.routers.auth._fetch_group_members", return_value=[]):
            for _ in range(10):
                self.c.post("/api/auth/validate", json={"username": "x"}, headers=hdr)
            r = self.c.post("/api/auth/validate", json={"username": "x"}, headers=hdr)
        self.assertEqual(r.status_code, 429)
        self.assertGreater(int(r.headers["Retry-After"]), 0)

    def test_ordinary_browsing_not_limited(self):
        self.assertIsNone(ratelimit.match_rule("GET", "/api/browse"))
        self.assertIsNone(ratelimit.match_rule("GET", "/api/voronoi/node/2026-09-24/batch"))


class TestExposure(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(app)

    def test_docs_disabled_by_default(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(self.c.get(path).status_code, 404, path)

    def test_cors_does_not_allow_credentials(self):
        r = self.c.options("/api/snapshots", headers={
            "Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
        self.assertNotEqual(r.headers.get("access-control-allow-credentials"), "true")

    def test_database_errors_do_not_leak(self):
        secret = "Code: 516. Authentication failed: tracker_api@clickhouse:9000 password=hunter2"
        with mock.patch("app.routers.snapshots.execute_query", side_effect=RuntimeError(secret)):
            r = self.c.get("/api/snapshots")
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("hunter2", r.text)
        self.assertNotIn("tracker_api", r.text)
        self.assertIn("ref ", r.json()["detail"])

    def test_health_does_not_leak(self):
        with mock.patch("app.db.get_client") as gc:
            gc.return_value.execute.side_effect = RuntimeError("host clickhouse:9000 refused, user default")
            r = self.c.get("/health")
        self.assertEqual(r.json(), {"status": "unhealthy", "database": "disconnected"})


if __name__ == "__main__":
    unittest.main()
