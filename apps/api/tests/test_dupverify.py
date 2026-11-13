"""Verified-duplicates API: read-only, safe when tables are absent, and
clearly separated from the probable (name + size) matches.

The SQL itself is exercised against a scratch ClickHouse server by
scripts/tests/dupverify_e2e_test.sh; here the client is stubbed.

Run from apps/api: python3 -m unittest discover -s tests
"""
import os
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import dupverify, recon  # noqa: E402

ROOT = "/project/cil"


class FakeClient:
    """Answers by matching a fragment of the SQL."""

    def __init__(self, answers):
        self.answers = answers
        self.queries = []

    def execute(self, sql, params=None, **kw):
        self.queries.append((sql, params))
        for frag, rows in self.answers:
            if frag in sql:
                return rows
        return []


class DupverifyApiTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app, raise_server_exceptions=False)
        self._env = mock.patch.dict(os.environ, {"HK_OPERATOR_KEY": "k" * 32, "HK_EXEC_TOKEN": "t" * 32})
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_routes_are_get_only(self):
        for r in app.routes:
            if isinstance(r, APIRoute) and r.path.startswith(dupverify.router.prefix):
                self.assertEqual(r.methods - {"HEAD"}, {"GET"}, r.path)

    def test_absent_tables_answer_unavailable(self):
        fake = FakeClient([("system.tables", [(0,)])])
        with mock.patch.object(dupverify, "get_client", return_value=fake):
            for path in ("status", "sets", "pending"):
                r = self.client.get(f"/api/housekeeping/verified-duplicates/{path}", params={"root": ROOT})
                self.assertEqual(r.status_code, 200, path)
                self.assertFalse(r.json()["available"])
        self.assertTrue(all("dupverify_files" not in q for q, _ in fake.queries))

    def test_unknown_root_rejected(self):
        r = self.client.get("/api/housekeeping/verified-duplicates/sets", params={"root": "/etc"})
        self.assertEqual(r.status_code, 422)

    def test_pending_status_is_validated(self):
        r = self.client.get("/api/housekeeping/verified-duplicates/pending",
                            params={"root": ROOT, "status": "complete"})
        self.assertEqual(r.status_code, 422)

    def test_sets_shape_and_savings(self):
        h = "a" * 64
        files = [(f"{ROOT}/lab/b.nc", "u2", 1, 11, 1, 4096, 0),
                 (f"{ROOT}/lab/a.nc", "u1", 1, 10, 2, 8192, 0),
                 (f"{ROOT}/lab/a_link.nc", "u1", 1, 10, 2, 8192, 0)]
        row = ("2026-11-13:abcd1234:8192", h, 8192, 2, 1, 0, "2026-11-13", "2026-11-14 01:00:00",
               "run1", 3, files)
        fake = FakeClient([("system.tables", [(4,)]), ("snapshots", [("2026-11-13",)]),
                           ("LEFT JOIN", [("2026-11-13:abcd1234:8192", h, 3, 2, 0)]),
                           ("dupverify_files", [row])])
        with mock.patch.object(dupverify, "get_client", return_value=fake):
            r = self.client.get("/api/housekeeping/verified-duplicates/sets", params={"root": ROOT})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        s = body["rows"][0]
        self.assertEqual(s["copies"], 2)
        self.assertEqual(s["potential_logical_bytes"], 8192)
        # Two inodes (the link is the same inode): allocated savings = the smaller one.
        self.assertEqual(s["potential_allocated_bytes"], 4096)
        self.assertEqual([f["path"] for f in s["files"]],
                         sorted(f[0] for f in files))
        self.assertEqual(s["owners"], ["u1", "u2"])
        self.assertTrue(s["byte_verified"])
        self.assertIn("not a deletion instruction", body["caveat"])
        # One of three files no longer matches the current snapshot.
        self.assertEqual(s["snapshot_check"]["state"], "needs_reverification")
        self.assertEqual(s["snapshot_check"]["changed"], 1)
        # Only complete groups' latest runs are eligible.
        sql = next(q for q, _ in fake.queries if "dupverify_files" in q)
        self.assertIn("status = 'complete'", sql)
        self.assertIn("argMax(run_id", sql)

    def test_root_prefix_is_a_parameter_not_sql(self):
        fake = FakeClient([("system.tables", [(4,)])])
        with mock.patch.object(dupverify, "get_client", return_value=fake):
            self.client.get("/api/housekeeping/verified-duplicates/sets", params={"root": ROOT})
        sql, params = next((q, p) for q, p in fake.queries if "dupverify_files" in q)
        self.assertNotIn(ROOT, sql)
        self.assertEqual(params["pfx"], ROOT + "/")

    def test_every_statement_is_a_select(self):
        fake = FakeClient([("system.tables", [(4,)])])
        with mock.patch.object(dupverify, "get_client", return_value=fake):
            for path in ("status", "sets", "pending"):
                self.client.get(f"/api/housekeeping/verified-duplicates/{path}", params={"root": ROOT})
        self.assertGreater(len(fake.queries), 3)
        for sql, _ in fake.queries:
            self.assertTrue(sql.lstrip().upper().startswith("SELECT"), sql[:80])
        self.assertNotIn("housekeeping import db", pathlib.Path(dupverify.__file__).read_text())


class ProbableDuplicatesLabelTest(unittest.TestCase):
    def test_probable_rows_are_marked_unverified(self):
        rows = [("out.nc", 2 << 30, 3, 4 << 30, ["/p/a/out.nc", "/p/b/out.nc"], ["u", "u"], 1)]
        fake = FakeClient([("filesystem.snapshots", [("2026-11-13",)]), ("GROUP BY name, size", rows)])
        recon._cache = recon.LRUCache(maxsize=4)
        with mock.patch.dict(os.environ, {"HK_OPERATOR_KEY": "k" * 32}), \
             mock.patch.object(recon, "get_client", return_value=fake):
            r = TestClient(app).get("/api/housekeeping/recon/duplicates", params={"root": ROOT})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["verification"], "unverified")
        self.assertEqual(body["basis"], "name_and_size")
        row = body["rows"][0]
        self.assertEqual(row["verification"], "unverified")
        self.assertEqual(row["potential_upper_bound"], row["wasted"])
        self.assertTrue(row["paths_truncated"])
        self.assertIn("not confirmed storage", body["caveat"])


if __name__ == "__main__":
    unittest.main()
