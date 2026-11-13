"""Access-control tests: the username is never a credential.

No database needed: every request asserted here is rejected by the guard
before a handler runs, or the handler's DB access is stubbed.

Run from apps/api: python3 -m unittest discover -s tests
"""
import contextlib
import os
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import security  # noqa: E402
from app.main import app  # noqa: E402

OPERATOR_KEY = "test-operator-key-0123456789"
EXEC_TOKEN = "test-exec-token-0123456789"


def _concrete(path: str) -> str:
    """Fill route parameters with harmless values."""
    out = []
    for part in path.split("/"):
        out.append("1" if part.startswith("{") else part)
    return "/".join(out)


def privileged_routes():
    """(method, template) for every route that must need the operator key."""
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        guarded = r.path.startswith("/api/housekeeping") or r.path == "/api/computing/ingest"
        if not guarded:
            continue
        for m in r.methods:
            if m in ("GET", "HEAD"):
                if r.path in security.OPERATOR_GETS:
                    yield m, r.path
            elif not (m == "POST" and r.path in security.READ_ONLY_POSTS):
                yield m, r.path


class SecurityTestBase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self._env = mock.patch.dict(os.environ, {
            "HK_OPERATOR_KEY": OPERATOR_KEY, "HK_EXEC_TOKEN": EXEC_TOKEN})
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def call(self, method, path, headers=None):
        return self.client.request(method, _concrete(path), headers=headers or {}, json={})


class TestUsernameIsNotACredential(SecurityTestBase):
    def test_route_inventory_is_not_empty(self):
        routes = list(privileged_routes())
        # 22 writes + 3 sensitive GETs at the time of writing; a drop means
        # routes moved out from under the guard.
        self.assertGreaterEqual(len(routes), 25, routes)

    def test_every_privileged_route_rejects_username_only(self):
        for method, path in privileged_routes():
            with self.subTest(method=method, path=path):
                r = self.call(method, path, {"X-User": "someone"})
                self.assertEqual(r.status_code, 403, r.text)

    def test_wrong_operator_key_rejected(self):
        for method, path in privileged_routes():
            with self.subTest(method=method, path=path):
                r = self.call(method, path, {"X-User": "someone", "X-Operator-Key": "guess"})
                self.assertEqual(r.status_code, 403, r.text)

    def test_exec_token_does_not_unlock_other_routes(self):
        for method, path in privileged_routes():
            if path in security.EXECUTOR_ROUTES:
                continue
            with self.subTest(method=method, path=path):
                r = self.call(method, path, {"X-User": "someone", "X-Exec-Token": EXEC_TOKEN})
                self.assertEqual(r.status_code, 403, r.text)

    def test_fail_closed_when_unconfigured(self):
        with mock.patch.dict(os.environ, {"HK_OPERATOR_KEY": ""}):
            r = self.call("POST", "/api/housekeeping/targets", {"X-User": "someone"})
            self.assertEqual(r.status_code, 503)
            # Even the "right" empty key must not match an empty secret.
            r = self.call("POST", "/api/housekeeping/targets", {"X-Operator-Key": ""})
            self.assertEqual(r.status_code, 503)

    def test_bad_exec_token_on_receipts_is_401(self):
        r = self.call("POST", "/api/housekeeping/receipts", {"X-Exec-Token": "nope"})
        self.assertEqual(r.status_code, 401)


class TestGuardAllowsLegitimateCallers(SecurityTestBase):
    """Valid credentials pass the guard (handlers stubbed: no database)."""

    def _stub_db(self):
        conn = mock.MagicMock()
        conn.execute.return_value.fetchone.return_value = ("someone",)
        return mock.patch("app.housekeeping.db.tx", lambda: contextlib.nullcontext(conn))

    def test_command_never_contains_the_token(self):
        with self._stub_db(), mock.patch("app.housekeeping.manifests.manifest_file",
                                         return_value=pathlib.Path("x.json.gz")):
            r = self.client.get("/api/housekeeping/manifests/abc/command",
                                headers={"X-User": "someone", "X-Operator-Key": OPERATOR_KEY})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn(EXEC_TOKEN, r.text)
        self.assertIn("~/.hk_exec_token", r.json()["command"])

    def test_receipt_accepts_exec_token_and_caps_size(self):
        from app.housekeeping import receipts as rcpt
        with self._stub_db(), mock.patch.object(rcpt, "start_job", return_value={"job_id": 7}):
            ok = self.client.post("/api/housekeeping/receipts", content=b'{"x":1}',
                                  headers={"X-User": "someone", "X-Exec-Token": EXEC_TOKEN})
            self.assertEqual(ok.status_code, 200, ok.text)
            with mock.patch.object(rcpt, "MAX_UPLOAD_BYTES", 10):
                big = self.client.post("/api/housekeeping/receipts", content=b"x" * 100,
                                       headers={"X-User": "someone", "X-Exec-Token": EXEC_TOKEN})
            self.assertEqual(big.status_code, 413)

    def test_operator_status_reports_without_leaking(self):
        anon = self.client.get("/api/housekeeping/operator").json()
        self.assertEqual(anon, {"configured": True, "unlocked": False})
        good = self.client.get("/api/housekeeping/operator",
                               headers={"X-Operator-Key": OPERATOR_KEY}).json()
        self.assertEqual(good, {"configured": True, "unlocked": True})
        self.assertNotIn(OPERATOR_KEY, str(good))

    def test_invalid_username_rejected_even_for_operator(self):
        with self._stub_db():
            r = self.client.get("/api/housekeeping/manifests/abc/command",
                                headers={"X-User": "bad name;--", "X-Operator-Key": OPERATOR_KEY})
        self.assertEqual(r.status_code, 400)


class TestReceiptDecoding(unittest.TestCase):
    def test_gzip_bomb_refused(self):
        import gzip
        from app.housekeeping import receipts as rcpt
        bomb = gzip.compress(b"0" * (2 * 1024**2))
        with mock.patch.object(rcpt, "MAX_RECEIPT_BYTES", 1024**2):
            with self.assertRaises(ValueError):
                rcpt.decode_receipt_bytes(bomb)
        self.assertEqual(rcpt.decode_receipt_bytes(gzip.compress(b'{"a":1}')), '{"a":1}')


class TestUsernameFormat(unittest.TestCase):
    def test_valid(self):
        for u in ["cadavidsanchez", "Ab.c-d_1", " rcc "]:
            self.assertIsNotNone(security.normalize_username(u), u)

    def test_invalid(self):
        for u in ["", " ", "a b", "x' OR 1=1", "../etc", "-lead", "a" * 40, "名前", "a\x00b", None]:
            self.assertIsNone(security.normalize_username(u), repr(u))


if __name__ == "__main__":
    unittest.main()
