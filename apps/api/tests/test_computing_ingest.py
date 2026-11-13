"""Computing ingest: stale reports are refused; rows carry the report date.

Run from apps/api: python3 -m unittest discover -s tests
"""
import os
import pathlib
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import computing  # noqa: E402

KEY = "ingest-test-operator-key-123"


def report(published: datetime) -> dict:
    return {
        "report_meta": {"published_at": published.isoformat()},
        "combined": {"service_units": {"allocated": 100, "consumed": 40, "remaining": 60}},
        "clusters": {"midway3": {"service_units": {"by_user": [{"user": "a", "consumed": 4}]},
                                 "quota": {"filesystems": [{"filesystem": "/project/cil", "type": "block"}]}}},
    }


class TestComputingIngest(unittest.TestCase):
    def setUp(self):
        self._env = mock.patch.dict(os.environ, {"HK_OPERATOR_KEY": KEY})
        self._env.start()
        self.c = TestClient(app)
        self.client = mock.MagicMock()
        self._w = mock.patch.object(computing, "_get_write_client", return_value=self.client)
        self._w.start()

    def tearDown(self):
        self._w.stop()
        self._env.stop()

    def ingest(self, data):
        with mock.patch.object(computing, "_fetch_report", return_value=data):
            return self.c.post("/api/computing/ingest", headers={"X-Operator-Key": KEY})

    def test_stale_report_is_refused_and_nothing_written(self):
        r = self.ingest(report(datetime.now(timezone.utc) - timedelta(days=62)))
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("stale", r.json()["detail"])
        self.client.execute.assert_not_called()

    def test_fresh_report_rows_use_the_report_date(self):
        published = datetime.now(timezone(timedelta(hours=-6))) - timedelta(hours=1)
        r = self.ingest(report(published))
        self.assertEqual(r.status_code, 200, r.text)
        dates = {row["date"] for call in self.client.execute.call_args_list for row in call.args[1]}
        self.assertEqual(dates, {published.date()})

    def test_missing_metadata_is_refused(self):
        r = self.ingest({"combined": {}, "clusters": {}})
        self.assertEqual(r.status_code, 422)

    def test_parse_published_at(self):
        self.assertEqual(computing.report_published_at(
            {"report_meta": {"published_at": "2026-09-12T14:20:03.168224-05:00"}}).date().isoformat(), "2026-09-12")
        self.assertIsNone(computing.report_published_at({"report_meta": {"published_at": "nope"}}))


if __name__ == "__main__":
    unittest.main()
