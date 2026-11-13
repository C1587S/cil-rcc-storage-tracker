#!/usr/bin/env python3
"""Benchmark content verification on a synthetic, HPC-like tree.

Measures the hashing stage separately from candidate selection: wall time,
bytes the tool reports reading, and device reads (ru_inblock) with the page
cache dropped for the dataset before every run (posix_fadvise DONTNEED; no
root needed; does not work on tmpfs, so use a disk-backed --dir). Optionally
compares with fclones on the same data and checks both find the same sets.

The dataset imitates what defeats name + size matching on /project/cil:
  siblings   same size, same 64 KiB header, different data (model outputs)
  dups       identical content under different names
  near       identical except one byte between sample offsets (samples collide)
  small      many small same-size files, some identical
  links      hard links to duplicate files

  python3 scripts/bench/dupverify_bench.py --dir ~/dupverify-bench --scale 1 \
      [--fclones /path/to/fclones] [--keep]
Synthetic data only; the directory is removed afterwards unless --keep.
"""
import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import time
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MiB = 1 << 20


def generate(d: str, scale: float, seed: int = 7) -> dict:
    rnd = random.Random(seed)
    os.makedirs(d, exist_ok=True)
    expect_sets = []  # sets of distinct-content duplicates (paths), excluding links

    def write(rel: str, data: bytes) -> str:
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        return p

    n = lambda x: max(1, int(x * scale))  # noqa: E731
    header = os.urandom(64 * 1024)
    for g in range(n(20)):                       # siblings: 6 x 16 MiB (+g) per size
        size = 16 * MiB + g * 4096
        for k in range(6):
            write(f"model/scen_{k}/run_{g:03d}/output.nc", header + os.urandom(size - len(header)))
    for g in range(n(10)):                       # true duplicates: 3 x 24 MiB (+g)
        data = os.urandom(24 * MiB + g * 4096 + 1)
        ps = [write(f"inputs/mirror_{k}/grid_{g:03d}_{'abc'[k]}.tif", data) for k in range(3)]
        expect_sets.append(sorted(ps))
    for g in range(n(5)):                        # near-duplicates: one byte differs
        size = 32 * MiB + g * 4096 + 3
        data = bytearray(os.urandom(size))
        write(f"near/a/blob_{g}.bin", bytes(data))
        data[size // 3 + rnd.randrange(4096)] ^= 0x5A  # between the spread sample offsets
        write(f"near/b/blob_{g}.bin", bytes(data))
    for g in range(n(20)):                       # small files: 100 per size, 10 distinct contents
        size = 64 * 1024 + g
        contents = [os.urandom(size) for _ in range(10)]
        by_content = defaultdict(list)
        for k in range(100):
            c = k % 10
            by_content[c].append(write(f"small/s{g:02d}/f{k:03d}.dat", contents[c]))
        expect_sets += [sorted(v) for v in by_content.values()]
    for g in range(min(n(10), 5)):               # hard links to some duplicates
        src = os.path.join(d, f"inputs/mirror_0/grid_{g:03d}_a.tif")
        dst = os.path.join(d, f"links/grid_{g:03d}.tif")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.link(src, dst)
    files = []
    for dp, _dn, fn in os.walk(d):
        for f in fn:
            p = os.path.join(dp, f)
            files.append((p, os.lstat(p).st_size))
    return {"files": files, "expect_sets": expect_sets}


def candidates(files, out: str, min_size: int) -> dict:
    by_size = defaultdict(list)
    for p, s in files:
        if s >= min_size:
            by_size[s].append(p)
    groups = {s: sorted(ps) for s, ps in by_size.items() if len(ps) >= 2}
    with open(out, "w") as f:
        for s, ps in sorted(groups.items(), key=lambda kv: -(len(kv[1]) - 1) * kv[0]):
            f.write(json.dumps({"group_id": f"bench:x:{s}", "size": s,
                                "files": [{"path": p} for p in ps]}) + "\n")
    return {"groups": len(groups), "files": sum(len(v) for v in groups.values()),
            "bytes": sum(s * len(v) for s, v in groups.items())}


def drop_cache(files):
    os.sync()
    for p, _ in files:
        try:
            fd = os.open(p, os.O_RDONLY)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            os.close(fd)
        except OSError:
            pass


def run_measured(cmd, files, cold=True) -> dict:
    """Run and collect rusage of exactly this child (device reads, CPU)."""
    if cold:
        drop_cache(files)
    t = time.perf_counter()
    pid = os.fork()
    if pid == 0:
        devnull = os.open(os.devnull, os.O_WRONLY)
        out_fd = os.open(cmd_out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.dup2(out_fd, 1)
        os.dup2(devnull, 2)
        os.execvp(cmd[0], cmd)
    _, status, ru = os.wait4(pid, 0)
    el = time.perf_counter() - t
    with open(cmd_out_path) as f:
        out = f.read()
    return {"elapsed_s": round(el, 3), "rc": os.waitstatus_to_exitcode(status),
            "device_read_bytes": ru.ru_inblock * 512, "cpu_s": round(ru.ru_utime + ru.ru_stime, 2),
            "max_rss_mib": round(ru.ru_maxrss / 1024, 1), "stdout": out}


def fclones_sets(stdout: str, base: str) -> list:
    """Parse `fclones group --format json` output into sets of paths."""
    d = json.loads(stdout)
    sets = []
    for g in d.get("groups", []):
        sets.append(sorted(g["files"]))
    return sets


def norm_sets(sets, links: set) -> set:
    # Hard links are one file: compare by content sets without link paths.
    return {tuple(sorted(p for p in s if p not in links)) for s in sets
            if len([p for p in s if p not in links]) >= 2}


cmd_out_path = ""


def main() -> int:
    global cmd_out_path
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--min-size", type=int, default=1)
    ap.add_argument("--fclones")
    ap.add_argument("--bin", default=os.path.join(ROOT, "scanner/target/release/cil-dupverify"))
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    d = os.path.abspath(os.path.expanduser(a.dir))
    if os.path.exists(d):
        raise SystemExit(f"{d} exists; choose a new directory")
    work = d + ".work"
    os.makedirs(work)
    cmd_out_path = os.path.join(work, "stdout")
    res = {"dataset": {}, "runs": {}}
    try:
        t = time.perf_counter()
        ds = generate(os.path.join(d, "data"), a.scale)
        res["dataset"]["generate_s"] = round(time.perf_counter() - t, 1)
        files = ds["files"]
        res["dataset"].update(files=len(files), bytes=sum(s for _, s in files))
        t = time.perf_counter()
        cand = os.path.join(work, "cand.jsonl")
        res["dataset"]["candidates"] = candidates(files, cand, a.min_size)
        res["dataset"]["candidate_select_s"] = round(time.perf_counter() - t, 3)
        links = {os.path.join(d, "data", "links", f) for f in os.listdir(os.path.join(d, "data", "links"))}
        expect = norm_sets(ds["expect_sets"], links)

        def dv(name, extra, cold=True, out=None):
            out = out or os.path.join(work, name)
            r = run_measured([a.bin, "--input", cand, "--out", out, "--quiet", "--max-read-mib-s", "0",
                              "--budget-gib", "0", *extra], files, cold)
            s = json.loads(r.pop("stdout"))
            sets = []
            with open(os.path.join(out, "results.jsonl")) as f:
                for line in f:
                    for ds_ in json.loads(line)["duplicate_sets"]:
                        sets.append([p["path"] for i in ds_["inodes"] for p in i["paths"]])
            r.update(tool_bytes_read=s["bytes_read"], sample_bytes=s["io"]["sample_bytes"],
                     full_bytes=s["io"]["full_bytes"], compare_bytes=s["io"]["compare_bytes"],
                     duplicate_sets=s["duplicate_sets"], matches_expected=norm_sets(sets, links) == expect)
            res["runs"][name] = r
            print(f"  {name:28s} {r['elapsed_s']:7.2f}s  tool {r['tool_bytes_read'] / MiB:9.1f} MiB  "
                  f"device {r['device_read_bytes'] / MiB:9.1f} MiB  sets={r['duplicate_sets']}  ok={r['matches_expected']}",
                  flush=True)

        print(f"dataset: {res['dataset']}", flush=True)
        dv("dupverify_w2", ["--workers", "2"])
        dv("dupverify_w8", ["--workers", "8"])
        dv("dupverify_w8_bytecmp", ["--workers", "8", "--byte-verify"])
        dv("dupverify_samples1_first", ["--workers", "8", "--samples", "1"])
        # Same cache, fresh results: everything comes from the digest cache.
        dv("dupverify_w8_cached", ["--workers", "8", "--no-resume",
                                   "--cache", os.path.join(work, "dupverify_w8", "hash-cache.jsonl")],
           out=os.path.join(work, "cached"))
        if a.fclones:
            for name, extra in (("fclones_default", []), ("fclones_t2", ["-t", "2"]), ("fclones_t8", ["-t", "8"])):
                r = run_measured([a.fclones, "group", os.path.join(d, "data"), "--format", "json",
                                  "-s", str(max(a.min_size, 1)), "--hidden", "--no-ignore", *extra], files)
                sets = fclones_sets(r.pop("stdout"), d)
                r.update(duplicate_sets=len(sets), matches_expected=norm_sets(sets, links) == expect)
                res["runs"][name] = r
                print(f"  {name:28s} {r['elapsed_s']:7.2f}s  device {r['device_read_bytes'] / MiB:9.1f} MiB  "
                      f"sets={r['duplicate_sets']}  ok={r['matches_expected']}", flush=True)
        res["dataset"]["expected_sets"] = len(expect)
        with open(os.path.join(work, "bench.json"), "w") as f:
            json.dump(res, f, indent=2)
        print(json.dumps(res, indent=2))
    finally:
        if not a.keep:
            shutil.rmtree(d, ignore_errors=True)
            shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
