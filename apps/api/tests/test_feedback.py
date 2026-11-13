"""Feedback: the displayed username can't delete; storage is never blanked.

Run from apps/api: python3 -m unittest discover -s tests
"""
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import feedback  # noqa: E402


class TestFeedback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = pathlib.Path(self.tmp.name) / "feedback.json"
        self._p = mock.patch.object(feedback, "FEEDBACK_FILE", self.file)
        self._p.start()
        feedback._cache.update({"data": None, "tree": None})
        self._env = mock.patch.dict(os.environ, {"HK_OPERATOR_KEY": "op-key-for-tests-123"})
        self._env.start()
        self.c = TestClient(app)

    def tearDown(self):
        self._p.stop()
        self._env.stop()
        self.tmp.cleanup()

    def post(self, user="alice", msg="hello", parent=None):
        return self.c.post("/api/feedback", json={"username": user, "message": msg, "parent_id": parent})

    def test_post_returns_token_but_list_never_exposes_it(self):
        r = self.post()
        self.assertEqual(r.status_code, 201)
        token = r.json()["delete_token"]
        listing = self.c.get("/api/feedback").text
        self.assertNotIn(token, listing)
        self.assertNotIn("delete_token", listing)
        self.assertNotIn(token, self.file.read_text())  # only the hash is stored

    def test_username_alone_cannot_delete(self):
        fid = self.post().json()["id"]
        r = self.c.delete(f"/api/feedback/{fid}?username=alice")
        self.assertEqual(r.status_code, 403)
        r = self.c.delete(f"/api/feedback/{fid}", headers={"X-Delete-Token": "guess"})
        self.assertEqual(r.status_code, 403)

    def test_owner_token_and_operator_can_delete(self):
        p1 = self.post().json()
        self.assertEqual(self.c.delete(f"/api/feedback/{p1['id']}",
                                       headers={"X-Delete-Token": p1["delete_token"]}).status_code, 204)
        p2 = self.post(user="bob").json()
        self.assertEqual(self.c.delete(f"/api/feedback/{p2['id']}",
                                       headers={"X-Operator-Key": "op-key-for-tests-123"}).status_code, 204)
        self.assertEqual(self.c.get("/api/feedback").json(), [])

    def test_invalid_username_rejected(self):
        self.assertEqual(self.post(user="<script>").status_code, 400)

    def test_corrupt_storage_is_not_overwritten(self):
        self.post()
        self.file.write_text('[{"id": "x", "trunc')  # simulate a partial write
        before = self.file.read_text()
        feedback._cache.update({"data": None, "tree": None})
        r = self.post(msg="new")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.file.read_text(), before)


if __name__ == "__main__":
    unittest.main()
