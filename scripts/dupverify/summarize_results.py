#!/usr/bin/env python3
"""Inspect a cil-dupverify output directory without any database.

Standard library only (runs on RCC login nodes). Prints counts, never
paths, unless --show-paths is given for local inspection.

  python3 scripts/dupverify/summarize_results.py --out ~/dupverify/pilot0/out
      [--recheck]                 stat every verified file: still the verified version?
      [--spot-check N]            byte-compare N of the smallest verified sets independently
      [--spot-check-max-mib M]    hard cap on bytes the spot check may read (default 256)
      [--show-paths]              list verified sets with paths (do not paste these anywhere)

  python3 scripts/dupverify/summarize_results.py --leak-check LOG [LOG ...] \
      --candidates ~/dupverify/pilot0/cand_pilot0.jsonl
      count occurrences of candidate paths, directory names and distinctive
      file names in the given logs (prints counts only; expect all zeros)

--recheck reads no file content (lstat only). --spot-check opens files
read-only (O_NOATIME where permitted) and reads at most the cap.
"""
import argparse
import glob
import json
import os
import stat
import sys
from collections import Counter

MiB = 1 << 20


def latest_results(out: str):
    latest, bad = {}, 0
    with open(os.path.join(out, "results.jsonl")) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                continue
            latest[r["group_id"]] = r
    return latest, bad


def version(st) -> tuple:
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def recheck(groups) -> dict:
    c = Counter()
    sets_unchanged = sets_total = 0
    for g in groups:
        for d in g["duplicate_sets"]:
            sets_total += 1
            ok = True
            for ino in d["inodes"]:
                want = (ino["dev"], ino["ino"], ino.get("size", g["size"]), ino.get("mtime_ns"), ino.get("ctime_ns"))
                for p in ino["paths"]:
                    try:
                        st = os.lstat(p["path"])
                    except FileNotFoundError:
                        c["missing"] += 1
                        ok = False
                        continue
                    except OSError:
                        c["unreadable"] += 1
                        ok = False
                        continue
                    if not stat.S_ISREG(st.st_mode):
                        c["no_longer_regular"] += 1
                        ok = False
                    elif want[3] is None:
                        c["no_version_recorded"] += 1
                        ok = False
                    elif version(st) == want:
                        c["unchanged"] += 1
                    else:
                        c["changed"] += 1
                        ok = False
            sets_unchanged += ok
    return {"paths": dict(c), "sets_total": sets_total, "sets_all_unchanged": sets_unchanged}


def open_ro(path):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        return os.open(path, flags | getattr(os, "O_NOATIME", 0))
    except PermissionError:
        return os.open(path, flags)


def same_bytes(a: str, b: str, size: int, budget: list) -> str:
    try:
        fa, fb = open_ro(a), open_ro(b)
    except OSError:
        return "skipped_unreadable"
    try:
        sa, sb = os.fstat(fa), os.fstat(fb)
        if sa.st_size != size or sb.st_size != size:
            return "skipped_changed"
        off, block = 0, MiB
        while off < size:
            n = min(block, size - off)
            if budget[0] < 2 * n:
                return "skipped_budget"
            budget[0] -= 2 * n
            if os.pread(fa, n, off) != os.pread(fb, n, off):
                return "mismatch"
            off += n
        for fd in (fa, fb):
            try:
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            except (AttributeError, OSError):
                pass
        if version(os.fstat(fa)) != version(sa) or version(os.fstat(fb)) != version(sb):
            return "skipped_changed"
        return "identical"
    finally:
        os.close(fa)
        os.close(fb)


def leak_check(candidates: str, logs: list) -> dict:
    """Search logs for anything from the candidate file. Generic tokens
    (short names, common words) are ignored; only distinctive ones count."""
    full, names, dirs = set(), set(), set()
    with open(candidates) as f:
        for line in f:
            if not line.strip():
                continue
            for c in json.loads(line)["files"]:
                p = c["path"]
                full.add(p)
                base = os.path.basename(p)
                if len(base) >= 8:
                    names.add(base)
                for part in p.split("/")[3:-1]:      # below /project/cil
                    if len(part) >= 8:
                        dirs.add(part)
    out = {"distinctive_tokens": {"paths": len(full), "file_names": len(names), "dir_names": len(dirs)}, "logs": {}}
    for log in logs:
        try:
            with open(log, errors="replace") as f:
                text = f.read()
        except OSError as e:
            out["logs"][os.path.basename(log)] = {"error": e.__class__.__name__}
            continue
        out["logs"][os.path.basename(log)] = {
            "bytes": len(text),
            "candidate_paths": sum(text.count(p) for p in full),
            "candidate_file_names": sum(1 for n in names if n in text),
            "candidate_dir_names": sum(1 for d in dirs if d in text),
            "project_paths": text.count("/project/") + text.count("/cds3/"),
        }
    out["clean"] = all(v.get("candidate_paths", 1) == 0 and v.get("candidate_file_names", 1) == 0
                       and v.get("candidate_dir_names", 1) == 0 and v.get("project_paths", 1) == 0
                       for v in out["logs"].values())
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leak-check", nargs="+", metavar="LOG")
    ap.add_argument("--candidates")
    ap.add_argument("--out")
    ap.add_argument("--recheck", action="store_true")
    ap.add_argument("--spot-check", type=int, default=0)
    ap.add_argument("--spot-check-max-mib", type=int, default=256)
    ap.add_argument("--show-paths", action="store_true")
    a = ap.parse_args()
    if a.leak_check:
        if not a.candidates:
            ap.error("--leak-check needs --candidates")
        r = leak_check(os.path.expanduser(a.candidates), a.leak_check)
        print(json.dumps(r, indent=2))
        return 0 if r["clean"] else 1
    if not a.out:
        ap.error("--out is required")
    out = os.path.expanduser(a.out)

    latest, bad = latest_results(out)
    status = Counter(r["status"] for r in latest.values())
    reasons = Counter(s["reason"] for r in latest.values() for s in r["skipped"])
    complete = [r for r in latest.values() if r["status"] == "complete"]
    sets = [(r, d) for r in complete for d in r["duplicate_sets"]]
    runs = []
    for p in sorted(glob.glob(os.path.join(out, "summary-*.json"))):
        with open(p) as f:
            s = json.load(f)
        row = {k: s.get(k) for k in ("run_id", "stopped", "elapsed_s", "bytes_read", "read_mib_s",
                                      "groups_complete", "groups_incomplete", "groups_not_attempted",
                                      "repaired_torn_lines")}
        row["files_opened"] = s.get("io", {}).get("files_opened")
        row["opened_without_noatime"] = s.get("io", {}).get("opened_without_noatime")
        runs.append(row)
    modes = {os.path.basename(p): oct(os.stat(p).st_mode & 0o777) for p in [out, *glob.glob(os.path.join(out, "*"))]}

    report = {
        "groups_by_latest_status": dict(status),
        "unparsable_lines": bad,
        "skip_reasons": dict(reasons),
        "verified_sets": len(sets),
        "verified_copies": sum(d["copies"] for _, d in sets),
        "byte_verified_sets": sum(d["byte_verified"] for _, d in sets),
        "sets_with_external_links": sum(d["external_links"] for _, d in sets),
        "potential_logical_GiB": round(sum(d["potential_logical_bytes"] for _, d in sets) / (1 << 30), 3),
        "potential_allocated_GiB": round(sum(d["potential_allocated_bytes"] for _, d in sets) / (1 << 30), 3),
        "inodes_examined_complete": sum(r["inodes_examined"] for r in complete),
        "confirmation_rate_groups": round(sum(bool(r["duplicate_sets"]) for r in complete) / len(complete), 4) if complete else None,
        "runs": runs,
        "file_modes": modes,
    }
    if a.recheck:
        report["recheck"] = recheck(complete)
    if a.spot_check:
        budget = [a.spot_check_max_mib * MiB]
        chosen = sorted(sets, key=lambda rd: rd[0]["size"])[: a.spot_check]
        results = Counter()
        for r, d in chosen:
            paths = [i["paths"][0]["path"] for i in d["inodes"]]
            results[same_bytes(paths[0], paths[1], r["size"], budget)] += 1
        report["spot_check"] = dict(results, sets=len(chosen),
                                    bytes_read_MiB=round((a.spot_check_max_mib * MiB - budget[0]) / MiB, 1))
    print(json.dumps(report, indent=2))
    if a.show_paths:
        print("\n# verified sets (local inspection only; do not share)", file=sys.stderr)
        for r, d in sorted(sets, key=lambda rd: -rd[1]["potential_logical_bytes"]):
            print(f"\n{d['blake3'][:16]}  size={r['size']}  copies={d['copies']}  byte_verified={d['byte_verified']}",
                  file=sys.stderr)
            for i in d["inodes"]:
                for p in i["paths"]:
                    print(f"  inode={i['ino']} nlink={i['nlink']}  {p['path']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
