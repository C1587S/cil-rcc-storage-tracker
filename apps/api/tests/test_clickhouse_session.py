"""ClickHouse session settings: read-only must never silently disappear.

Run from apps/api: python3 -m unittest discover -s tests
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.db.clickhouse import session_settings  # noqa: E402
from app.settings import Settings  # noqa: E402


def make(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


class TestSessionSettings(unittest.TestCase):
    def test_default_account_is_always_readonly(self):
        # Even if someone sets the flag off, the admin account stays readonly=1.
        s = session_settings(make(clickhouse_user="default", clickhouse_session_readonly=False))
        self.assertEqual(s["readonly"], 1)

    def test_readonly_account_relies_on_its_profile(self):
        s = session_settings(make(clickhouse_user="tracker_api", clickhouse_session_readonly=False))
        self.assertNotIn("readonly", s)

    def test_flag_defaults_to_readonly(self):
        s = session_settings(make(clickhouse_user="tracker_api"))
        self.assertEqual(s["readonly"], 1)

    def test_limits_always_sent(self):
        s = session_settings(make(clickhouse_user="tracker_api", clickhouse_session_readonly=False,
                                  max_execution_time=20, max_result_rows=8000))
        self.assertEqual((s["max_execution_time"], s["max_result_rows"]), (20, 8000))


if __name__ == "__main__":
    unittest.main()
