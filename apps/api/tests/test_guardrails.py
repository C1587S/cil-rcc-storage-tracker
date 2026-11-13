"""SQL linter / guardrail tests. Pure — no database required.

Run from apps/api: python3 -m unittest discover -s tests
"""
import pathlib
import sys
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.guardrails import (  # noqa: E402
    QueryValidationError,
    _safe_int_arith,
    enforce_sql_guardrails,
    lint_clickhouse_sql,
)

BASE = "SELECT count() FROM filesystem.entries WHERE snapshot_date = '2026-09-24' AND modified_time < now() - "


class TestIntervalArithmetic(unittest.TestCase):
    def test_simple_products_are_folded(self):
        self.assertIn("INTERVAL 1825 DAY", lint_clickhouse_sql(BASE + "INTERVAL 5*365 DAY"))
        self.assertIn("INTERVAL 60 DAY", lint_clickhouse_sql(BASE + "INTERVAL 2 * 30 DAY"))

    def test_precedence(self):
        self.assertEqual(_safe_int_arith("2*30+5"), 65)
        self.assertEqual(_safe_int_arith("10-2*3"), 4)
        self.assertEqual(_safe_int_arith("3*4-2*5"), 2)

    def test_plain_number_unchanged(self):
        self.assertIn("INTERVAL 30 DAY", lint_clickhouse_sql(BASE + "INTERVAL 30 DAY"))

    def test_exponentiation_is_never_evaluated(self):
        # Previously eval()'d: 9**9**9**9 hangs the process.
        start = time.monotonic()
        out = lint_clickhouse_sql(BASE + "INTERVAL 9**9**9**9 DAY")
        self.assertLess(time.monotonic() - start, 0.5)
        self.assertIn("9**9**9**9", out)
        self.assertIsNone(_safe_int_arith("9**9"))

    def test_bounds(self):
        self.assertIsNone(_safe_int_arith("9999999999"))           # operand too long
        self.assertIsNone(_safe_int_arith("100000*100000"))        # result too large
        self.assertIsNone(_safe_int_arith("99999*99999*99999"))    # intermediate too large

    def test_malformed_rejected(self):
        for expr in ["-5", "5-", "*5", "5**", "5 5", "", "5+*3"]:
            with self.subTest(expr=expr):
                self.assertIsNone(_safe_int_arith(expr))


class TestGuardrails(unittest.TestCase):
    def test_select_only(self):
        with self.assertRaises(QueryValidationError):
            enforce_sql_guardrails("DROP TABLE filesystem.entries")

    def test_multiple_statements_rejected(self):
        with self.assertRaises(QueryValidationError):
            enforce_sql_guardrails("SELECT 1 WHERE snapshot_date='x'; SELECT 2")

    def test_table_functions_rejected(self):
        with self.assertRaises(QueryValidationError):
            enforce_sql_guardrails("SELECT * FROM url('http://x', CSV) WHERE snapshot_date='x'")

    def test_limit_capped(self):
        out = enforce_sql_guardrails("SELECT path FROM filesystem.entries WHERE snapshot_date='x' LIMIT 99999", limit=100)
        self.assertIn("LIMIT 100", out)


if __name__ == "__main__":
    unittest.main()
