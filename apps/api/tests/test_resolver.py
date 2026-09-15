"""Selector resolver tests. Pure — no database required.

Run: python3 -m unittest apps/api/tests/test_resolver.py (from repo root,
with apps/api on the path) or via pytest inside the api container.
"""
import sys
import pathlib
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.housekeeping.resolver import (  # noqa: E402
    ResolverError, resolve, rollup_sql, members_sql,
)


class TestRootScoping(unittest.TestCase):
    def test_root_must_be_known(self):
        with self.assertRaises(ResolverError):
            resolve("/scratch/foo", "2026-09-11", "/scratch/foo/x")

    def test_path_must_live_under_root(self):
        with self.assertRaises(ResolverError):
            resolve("/cds3/cil", "2026-09-11", "/project/cil/gcp")

    def test_sibling_prefix_cannot_leak(self):
        # /cds3/cil-old must NOT be matched by a /cds3/cil target
        rq = resolve("/cds3/cil", "2026-09-11", "/cds3/cil")
        self.assertIn("path = %(tpath)s OR path LIKE %(tprefix)s", rq.where)
        self.assertEqual(rq.params["tprefix"], "/cds3/cil/%")
        self.assertNotIn("'/cds3/cil%'", rq.where)

    def test_root_equal_path_allowed(self):
        rq = resolve("/cds3/cil", "2026-09-11", "/cds3/cil")
        self.assertEqual(rq.params["tpath"], "/cds3/cil")


class TestScopes(unittest.TestCase):
    def test_subtree_selects_files_only(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/gcp")
        self.assertIn("is_directory = 0", rq.where)

    def test_shallow_uses_parent_path(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/gcp", scope="shallow")
        self.assertIn("parent_path = %(tpath)s", rq.where)
        self.assertNotIn("LIKE", rq.where)

    def test_single_file_exact_match(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/gcp/a.log", scope="single_file")
        self.assertIn("path = %(tpath)s", rq.where)
        self.assertNotIn("LIKE", rq.where)

    def test_unknown_scope_rejected(self):
        with self.assertRaises(ResolverError):
            resolve("/project/cil", "2026-09-11", "/project/cil/gcp", scope="everything")


class TestPredicates(unittest.TestCase):
    ROOT, SNAP, PATH = "/project/cil", "2026-09-11", "/project/cil/gcp"

    def test_unknown_keys_rejected(self):
        with self.assertRaises(ResolverError):
            resolve(self.ROOT, self.SNAP, self.PATH, predicate={"rm_rf": True})

    def test_ext_requires_dot(self):
        with self.assertRaises(ResolverError):
            resolve(self.ROOT, self.SNAP, self.PATH, predicate={"ext": ["err"]})

    def test_ext_multi_or(self):
        rq = resolve(self.ROOT, self.SNAP, self.PATH, predicate={"ext": [".err", ".log"]})
        self.assertIn("endsWith(path, %(ext0)s) OR endsWith(path, %(ext1)s)", rq.where)
        self.assertEqual(rq.params["ext0"], ".err")

    def test_dates_become_epochs(self):
        rq = resolve(self.ROOT, self.SNAP, self.PATH, predicate={"mtime_before": "2025-03-01"})
        self.assertIsInstance(rq.params["mtime_before"], int)
        self.assertGreater(rq.params["mtime_before"], 1_700_000_000)

    def test_bad_date_rejected(self):
        with self.assertRaises(ResolverError):
            resolve(self.ROOT, self.SNAP, self.PATH, predicate={"mtime_before": "March 2025"})

    def test_sizes_coerced_to_int(self):
        rq = resolve(self.ROOT, self.SNAP, self.PATH, predicate={"size_lt": "4096"})
        self.assertEqual(rq.params["size_lt"], 4096)


class TestPathSegment(unittest.TestCase):
    def test_segment_matches_infix_directory(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/gcp",
                     predicate={"path_segment": "__pycache__"})
        self.assertIn("position(path, %(pseg)s) > 0", rq.where)
        self.assertEqual(rq.params["pseg"], "/__pycache__/")

    def test_segment_rejects_slashes(self):
        with self.assertRaises(ResolverError):
            resolve("/project/cil", "2026-09-11", "/project/cil/gcp",
                    predicate={"path_segment": "a/b"})


class TestProtectedSegments(unittest.TestCase):
    def test_exclusions_become_negative_conditions(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/home_dirs",
                     predicate={"ext": [".log"]}, exclude_segments=["envs", "pkgs"])
        self.assertIn("position(path, %(prot0)s) = 0", rq.where)
        self.assertEqual(rq.params["prot0"], "/envs/")
        self.assertEqual(rq.params["prot1"], "/pkgs/")

    def test_bad_segment_rejected(self):
        with self.assertRaises(ResolverError):
            resolve("/project/cil", "2026-09-11", "/project/cil/x",
                    exclude_segments=["a/b"])

    def test_no_exclusions_changes_nothing(self):
        a = resolve("/project/cil", "2026-09-11", "/project/cil/x")
        b = resolve("/project/cil", "2026-09-11", "/project/cil/x", exclude_segments=[])
        self.assertEqual(a.where, b.where)


class TestInjectionSafety(unittest.TestCase):
    def test_no_user_value_ever_lands_in_sql_text(self):
        hostile = "/project/cil/x'; DROP TABLE filesystem.entries; --"
        rq = resolve("/project/cil", "2026-09-11", hostile,
                     predicate={"ext": [".err'; --"], "name": "a'b", "owner": ["x'y"]})
        for sql in (rq.where, rollup_sql(rq), members_sql(rq)):
            self.assertNotIn("DROP", sql)
            self.assertNotIn("'; --", sql)
        # hostile values exist only as bound params
        self.assertEqual(rq.params["tpath"], hostile)

    def test_members_limit_is_int_coerced(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/gcp")
        with self.assertRaises(ValueError):
            members_sql(rq, limit="10; DROP TABLE x")  # type: ignore[arg-type]


class TestHashConsistency(unittest.TestCase):
    def test_members_sql_uses_clickhouse_cityhash(self):
        rq = resolve("/project/cil", "2026-09-11", "/project/cil/gcp")
        self.assertIn("cityHash64(path)", members_sql(rq))


if __name__ == "__main__":
    unittest.main()
