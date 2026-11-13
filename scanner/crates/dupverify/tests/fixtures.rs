//! Behaviour on synthetic fixtures. Every fixture lives in a temp dir; no
//! real paths are used.

use dupverify::model::*;
use dupverify::run::{self, ResultLine, RunConfig, Summary, RESULTS_FILE};
use dupverify::verify::Settings;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{FileExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tempfile::TempDir;

// Small blocks so tiny fixtures still exercise sampling and multi-block reads.
fn settings() -> Settings {
    Settings { sample_block: 4096, samples: 3, read_block: 4096, ..Settings::default() }
}

struct Fx {
    dir: TempDir,
    groups: Vec<CandidateGroup>,
}

impl Fx {
    fn new() -> Self {
        Fx { dir: TempDir::new().unwrap(), groups: vec![] }
    }
    fn p(&self, rel: &str) -> PathBuf {
        self.dir.path().join("data").join(rel)
    }
    fn write(&self, rel: &str, bytes: &[u8]) -> String {
        let p = self.p(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, bytes).unwrap();
        p.to_string_lossy().into_owned()
    }
    fn group(&mut self, id: &str, size: u64, paths: &[String]) {
        self.groups.push(CandidateGroup {
            group_id: id.into(), size, truncated: false,
            files: paths.iter().map(|p| CandidateFile { path: p.clone(), owner: Some("user_a".into()) }).collect(),
        });
    }
    fn input(&self) -> PathBuf {
        let p = self.dir.path().join("candidates.jsonl");
        let mut f = File::create(&p).unwrap();
        for g in &self.groups {
            writeln!(f, "{}", serde_json::to_string(g).unwrap()).unwrap();
        }
        p
    }
    fn out(&self) -> PathBuf {
        self.dir.path().join("out")
    }
    fn cfg(&self) -> RunConfig {
        let mut c = RunConfig::new(self.input(), self.out());
        c.settings = settings();
        c.workers = 2;
        c
    }
}

fn run_cfg(c: &RunConfig) -> Summary {
    run::run(c, None).unwrap()
}

/// Latest result per group.
fn results(out: &Path) -> HashMap<String, GroupResult> {
    let mut m = HashMap::new();
    for line in BufReader::new(File::open(out.join(RESULTS_FILE)).unwrap()).lines() {
        let r: ResultLine = serde_json::from_str(&line.unwrap()).unwrap();
        m.insert(r.result.group_id.clone(), r.result);
    }
    m
}

fn pattern(seed: u8, len: usize) -> Vec<u8> {
    (0..len).map(|i| (i as u32).wrapping_mul(2654435761).wrapping_add(seed as u32) as u8 ^ seed).collect()
}

fn reasons(r: &GroupResult) -> Vec<SkipReason> {
    r.skipped.iter().map(|s| s.reason).collect()
}

#[test]
fn identical_content_different_names_is_verified() {
    let mut fx = Fx::new();
    let data = pattern(1, 50_000);
    let a = fx.write("a/run_001.nc", &data);
    let b = fx.write("b/copy_of_results.bin", &data);
    fx.group("g1", data.len() as u64, &[a.clone(), b.clone()]);
    let s = run_cfg(&fx.cfg());
    let r = &results(&fx.out())["g1"];
    assert_eq!(r.status, GroupStatus::Complete);
    assert_eq!(r.duplicate_sets.len(), 1);
    let d = &r.duplicate_sets[0];
    assert_eq!(d.copies, 2);
    assert_eq!(d.potential_logical_bytes, 50_000);
    assert_eq!(d.blake3, blake3::hash(&data).to_hex().to_string());
    assert!(!d.byte_verified);
    assert_eq!(s.duplicate_sets, 1);
    assert_eq!(s.verified_logical_bytes, 50_000);
    assert_eq!(s.confirmation_rate_groups, Some(1.0));
}

#[test]
fn same_name_and_size_different_content_is_not_a_duplicate() {
    let mut fx = Fx::new();
    let a = fx.write("x/output.dat", &pattern(1, 30_000));
    let b = fx.write("y/output.dat", &pattern(2, 30_000));
    fx.group("g1", 30_000, &[a, b]);
    let s = run_cfg(&fx.cfg());
    let r = &results(&fx.out())["g1"];
    assert_eq!(r.status, GroupStatus::Complete);
    assert!(r.duplicate_sets.is_empty());
    assert_eq!(r.unique_inodes, 2);
    // Samples already differ: no full read was needed.
    assert_eq!(r.io.full_bytes, 0);
    assert!(r.io.sample_bytes > 0);
    assert_eq!(s.confirmation_rate_groups, Some(0.0));
}

#[test]
fn identical_samples_but_different_elsewhere_needs_full_hash() {
    let mut fx = Fx::new();
    let size = 400_000usize;
    let base = pattern(3, size);
    let mut other = base.clone();
    // Offsets sampled for size 400000, block 4096, 3 samples: 0, ~197952, 395904.
    other[100_000] ^= 0xff;
    let a = fx.write("a.h5", &base);
    let b = fx.write("b.h5", &other);
    let c = fx.write("c.h5", &base);
    fx.group("g1", size as u64, &[a.clone(), b.clone(), c.clone()]);
    run_cfg(&fx.cfg());
    let r = &results(&fx.out())["g1"];
    assert_eq!(r.status, GroupStatus::Complete);
    assert_eq!(r.io.full_bytes, 3 * size as u64, "all three collide on samples");
    assert_eq!(r.duplicate_sets.len(), 1);
    let paths: Vec<_> = r.duplicate_sets[0].inodes.iter().map(|i| i.paths[0].path.clone()).collect();
    assert!(paths.contains(&a) && paths.contains(&c) && !paths.contains(&b));
    assert_eq!(r.unique_inodes, 1);
}

#[test]
fn hard_links_are_one_file_not_duplicates() {
    let mut fx = Fx::new();
    let data = pattern(4, 20_000);
    let a = fx.write("a.bin", &data);
    let link = fx.p("link_to_a.bin");
    fs::hard_link(&a, &link).unwrap();
    let link = link.to_string_lossy().into_owned();
    // Only links: nothing to compare.
    fx.group("links_only", 20_000, &[a.clone(), link.clone()]);
    // Links plus an independent copy.
    let c = fx.write("copy.bin", &data);
    let mut fx2_paths = vec![a.clone(), link.clone(), c.clone()];
    fx2_paths.sort();
    fx.group("links_and_copy", 20_000, &fx2_paths);
    run_cfg(&fx.cfg());
    let res = results(&fx.out());
    let r = &res["links_only"];
    assert_eq!(r.status, GroupStatus::Skipped);
    assert_eq!(r.hardlink_paths, 1);
    assert!(r.duplicate_sets.is_empty());
    let r = &res["links_and_copy"];
    assert_eq!(r.status, GroupStatus::Complete);
    assert_eq!(r.hardlink_paths, 1);
    let d = &r.duplicate_sets[0];
    assert_eq!(d.copies, 2, "two inodes, three paths");
    assert_eq!(d.potential_logical_bytes, 20_000, "removing a link frees nothing");
    let linked = d.inodes.iter().find(|i| i.paths.len() == 2).expect("linked inode");
    assert_eq!(linked.nlink, 2);
    assert!(!d.external_links);
}

#[test]
fn links_outside_the_candidate_set_are_flagged() {
    let mut fx = Fx::new();
    let data = pattern(5, 9_000);
    let a = fx.write("a.bin", &data);
    let b = fx.write("b.bin", &data);
    fs::hard_link(&a, fx.p("elsewhere.bin")).unwrap();
    fx.group("g1", 9_000, &[a, b]);
    run_cfg(&fx.cfg());
    assert!(results(&fx.out())["g1"].duplicate_sets[0].external_links);
}

#[test]
fn symlinks_and_non_regular_files_are_skipped() {
    let mut fx = Fx::new();
    let data = pattern(6, 10_000);
    let a = fx.write("a.bin", &data);
    let b = fx.write("b.bin", &data);
    let sl = fx.p("sym.bin");
    std::os::unix::fs::symlink(&a, &sl).unwrap();
    let dir = fx.p("subdir");
    fs::create_dir_all(&dir).unwrap();
    let missing = fx.p("gone.bin").to_string_lossy().into_owned();
    fx.group("g1", 10_000, &[a, b, sl.to_string_lossy().into_owned(),
                              dir.to_string_lossy().into_owned(), missing]);
    run_cfg(&fx.cfg());
    let r = &results(&fx.out())["g1"];
    let rs = reasons(r);
    assert!(rs.contains(&SkipReason::Symlink));
    assert!(rs.contains(&SkipReason::NotRegular));
    assert!(rs.contains(&SkipReason::Missing));
    assert_eq!(r.duplicate_sets.len(), 1);
    assert_eq!(r.duplicate_sets[0].copies, 2, "the symlink is not a copy");
}

#[test]
fn zero_byte_files_are_not_compared() {
    let mut fx = Fx::new();
    let a = fx.write("empty1", b"");
    let b = fx.write("empty2", b"");
    fx.group("g0", 0, &[a, b]);
    let s = run_cfg(&fx.cfg());
    let r = &results(&fx.out())["g0"];
    assert_eq!(r.status, GroupStatus::Skipped);
    assert!(reasons(r).iter().all(|x| *x == SkipReason::ZeroSize));
    assert_eq!(s.bytes_read, 0);
}

#[test]
fn file_changed_since_snapshot_is_reported() {
    let mut fx = Fx::new();
    let a = fx.write("a", &pattern(7, 5_000));
    let b = fx.write("b", &pattern(7, 6_000));
    fx.group("g1", 5_000, &[a, b]);
    run_cfg(&fx.cfg());
    let r = &results(&fx.out())["g1"];
    assert!(reasons(r).contains(&SkipReason::SizeChanged));
    assert!(r.duplicate_sets.is_empty());
}

#[test]
fn large_sparse_files_report_allocated_savings() {
    let mut fx = Fx::new();
    let size = 64u64 << 20;
    let mut paths = vec![];
    for n in ["s1", "s2"] {
        let p = fx.p(n);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let f = File::create(&p).unwrap();
        f.set_len(size).unwrap();
        f.write_at(b"tail", size - 4).unwrap();
        paths.push(p.to_string_lossy().into_owned());
    }
    fx.group("big", size, &paths);
    let mut c = fx.cfg();
    c.settings.read_block = 1 << 20;
    run_cfg(&c);
    let r = &results(&fx.out())["big"];
    assert_eq!(r.status, GroupStatus::Complete);
    let d = &r.duplicate_sets[0];
    assert_eq!(d.potential_logical_bytes, size);
    if d.inodes[0].sparse {
        assert!(d.potential_allocated_bytes < size / 8, "sparse copies allocate little");
    }
    assert_eq!(r.io.full_bytes, 2 * size);
}

#[test]
fn budget_stops_cleanly_and_counts_nothing_as_verified() {
    let mut fx = Fx::new();
    let data = pattern(8, 1 << 20);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    fx.group("g1", data.len() as u64, &[a, b]);
    let mut c = fx.cfg();
    c.budget_bytes = Some(1 << 20); // enough for samples + one full read, not two
    let s = run_cfg(&c);
    assert_eq!(s.stopped.as_deref(), Some("budget"));
    assert!(s.bytes_read <= 1 << 20);
    let r = &results(&fx.out())["g1"];
    assert_eq!(r.status, GroupStatus::Incomplete);
    assert!(r.duplicate_sets.is_empty());
    assert!(reasons(r).contains(&SkipReason::BudgetExhausted));
    assert_eq!(s.verified_logical_bytes, 0);
    // Resume with a larger budget finishes the group.
    c.budget_bytes = Some(10 << 20);
    let s2 = run_cfg(&c);
    assert!(s2.stopped.is_none());
    assert_eq!(results(&fx.out())["g1"].status, GroupStatus::Complete);
    assert_eq!(s2.verified_logical_bytes, 1 << 20);
}

#[test]
fn change_during_hashing_is_detected() {
    let mut fx = Fx::new();
    let data = pattern(9, 200_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    fx.group("g1", 200_000, &[a.clone(), b.clone()]);
    let c = fx.cfg();
    let fired = AtomicBool::new(false);
    let target = b.clone();
    // After the first block of b is hashed, overwrite a later byte in place
    // (same size; mtime/ctime change).
    let hook = move |path: &str, off: u64| {
        if path == target && off == 4096 && !fired.swap(true, Ordering::SeqCst) {
            let f = OpenOptions::new().write(true).open(path).unwrap();
            f.write_at(b"Z", 150_000).unwrap();
            f.sync_all().unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    };
    run::run(&c, Some(&hook)).unwrap();
    let r = &results(&fx.out())["g1"];
    assert!(reasons(r).contains(&SkipReason::ChangedDuringRead), "{r:?}");
    assert!(r.duplicate_sets.is_empty(), "a file that changed is never verified");
}

#[test]
fn growth_during_hashing_is_detected() {
    let mut fx = Fx::new();
    let data = pattern(10, 200_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    fx.group("g1", 200_000, &[a, b.clone()]);
    let fired = AtomicBool::new(false);
    let hook = move |path: &str, _off: u64| {
        if path == b && !fired.swap(true, Ordering::SeqCst) {
            let mut f = OpenOptions::new().append(true).open(path).unwrap();
            f.write_all(b"more").unwrap();
        }
    };
    run::run(&fx.cfg(), Some(&hook)).unwrap();
    let r = &results(&fx.out())["g1"];
    assert!(reasons(r).contains(&SkipReason::ChangedDuringRead));
    assert!(r.duplicate_sets.is_empty());
}

#[test]
fn permission_denied_is_reported() {
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("running as root: permission test skipped");
        return;
    }
    let mut fx = Fx::new();
    let data = pattern(11, 12_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    let c = fx.write("locked", &data);
    fs::set_permissions(&c, fs::Permissions::from_mode(0o000)).unwrap();
    fx.group("g1", 12_000, &[a, b, c.clone()]);
    run_cfg(&fx.cfg());
    fs::set_permissions(&c, fs::Permissions::from_mode(0o600)).unwrap();
    let r = &results(&fx.out())["g1"];
    assert!(r.skipped.iter().any(|s| s.path == c && s.reason == SkipReason::PermissionDenied));
    assert_eq!(r.duplicate_sets[0].copies, 2);
}

#[test]
fn interrupt_then_resume_completes_without_rereading_finished_groups() {
    let mut fx = Fx::new();
    for g in 0..6u8 {
        let data = pattern(20 + g, 100_000);
        let a = fx.write(&format!("g{g}/a"), &data);
        let b = fx.write(&format!("g{g}/b"), &data);
        fx.group(&format!("g{g}"), 100_000, &[a, b]);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let mut c = fx.cfg();
    c.workers = 1;
    c.stop_flag = Some(stop.clone());
    let stop_h = stop.clone();
    // Interrupt while the third group is being fully hashed.
    let hook = move |path: &str, off: u64| {
        if path.contains("/g2/") && off >= 8192 {
            stop_h.store(true, Ordering::SeqCst);
        }
    };
    let s1 = run::run(&c, Some(&hook)).unwrap();
    assert_eq!(s1.stopped.as_deref(), Some("interrupted"));
    assert_eq!(s1.groups_complete, 2);
    assert_eq!(s1.groups_incomplete, 1);
    let r1 = results(&fx.out());
    assert_eq!(r1["g2"].status, GroupStatus::Incomplete);
    assert!(reasons(&r1["g2"]).contains(&SkipReason::Interrupted));

    stop.store(false, Ordering::SeqCst);
    let s2 = run_cfg(&c);
    assert!(s2.stopped.is_none());
    assert_eq!(s2.groups_already_done, 2);
    assert_eq!(s2.groups_complete, 4);
    let r2 = results(&fx.out());
    assert!(r2.values().all(|r| r.status == GroupStatus::Complete && r.duplicate_sets.len() == 1));
    assert_eq!(r2.len(), 6);
}

#[test]
fn cache_is_reused_and_invalidated_by_any_change() {
    let mut fx = Fx::new();
    let data = pattern(30, 300_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    fx.group("g1", 300_000, &[a.clone(), b.clone()]);
    let mut c = fx.cfg();
    let s1 = run_cfg(&c);
    assert_eq!(s1.io.full_bytes, 600_000);

    // Fresh results, same cache: nothing is read again.
    c.resume = false;
    let s2 = run_cfg(&c);
    assert_eq!(s2.bytes_read, 0);
    assert!(s2.io.cache_hits >= 4);
    assert_eq!(s2.duplicate_sets, 1);

    // Rewrite b with identical bytes and restore its mtime: ctime still
    // changes, so its cached digests must not be reused.
    let before = fs::metadata(&b).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    fs::write(&b, &data).unwrap();
    let ts = [
        libc::timespec { tv_sec: before.atime(), tv_nsec: before.atime_nsec() },
        libc::timespec { tv_sec: before.mtime(), tv_nsec: before.mtime_nsec() },
    ];
    let cpath = std::ffi::CString::new(b.clone()).unwrap();
    assert_eq!(unsafe { libc::utimensat(libc::AT_FDCWD, cpath.as_ptr(), ts.as_ptr(), 0) }, 0);
    assert_eq!(fs::metadata(&b).unwrap().mtime_nsec(), before.mtime_nsec());
    let s3 = run_cfg(&c);
    assert_eq!(s3.io.full_bytes, 300_000, "only b is re-hashed");
    assert!(s3.io.sample_bytes > 0);
    assert_eq!(s3.duplicate_sets, 1);
}

#[test]
fn groups_larger_than_eight_files_are_fully_listed() {
    let mut fx = Fx::new();
    let same = pattern(40, 25_000);
    let mut paths = vec![];
    for i in 0..12 {
        paths.push(fx.write(&format!("rep/copy_{i:02}"), &same));
    }
    for i in 0..3u8 {
        paths.push(fx.write(&format!("rep/other_{i}"), &pattern(50 + i, 25_000)));
    }
    fx.group("big", 25_000, &paths);
    let s = run_cfg(&fx.cfg());
    let r = &results(&fx.out())["big"];
    assert_eq!(r.duplicate_sets.len(), 1);
    assert_eq!(r.duplicate_sets[0].copies, 12);
    assert_eq!(r.duplicate_sets[0].inodes.len(), 12);
    assert_eq!(r.unique_inodes, 3);
    assert_eq!(s.verified_logical_bytes, 11 * 25_000);
}

#[test]
fn byte_verify_confirms_sets() {
    let mut fx = Fx::new();
    let data = pattern(60, 70_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    let c = fx.write("c", &data);
    fx.group("g1", 70_000, &[a, b, c]);
    let mut cfg = fx.cfg();
    cfg.settings.byte_verify = true;
    run_cfg(&cfg);
    let r = &results(&fx.out())["g1"];
    let d = &r.duplicate_sets[0];
    assert!(d.byte_verified);
    assert_eq!(d.copies, 3);
    assert_eq!(r.io.compare_bytes, 2 * 2 * 70_000);
}

#[test]
fn prefix_targeting_and_group_limits() {
    let mut fx = Fx::new();
    let data = pattern(70, 8_000);
    let a = fx.write("lab1/a", &data);
    let b = fx.write("lab1/b", &data);
    let c = fx.write("lab10/c", &data); // must not match prefix lab1
    fx.group("g1", 8_000, &[a, b, c.clone()]);
    let many: Vec<String> = (0..5).map(|i| fx.write(&format!("many/{i}"), &data)).collect();
    fx.group("g2", 8_000, &many);
    let mut cfg = fx.cfg();
    cfg.settings.prefixes = vec![fx.p("lab1").to_string_lossy().into_owned()];
    cfg.settings.max_group_files = 4;
    run_cfg(&cfg);
    let res = results(&fx.out());
    let r = &res["g1"];
    assert!(r.skipped.iter().any(|s| s.path == c && s.reason == SkipReason::OutOfScope));
    assert_eq!(r.duplicate_sets[0].copies, 2);
    assert_eq!(res["g2"].status, GroupStatus::Deferred);
    assert_eq!(res["g2"].io.total(), 0);
}

#[test]
fn outputs_are_private() {
    let mut fx = Fx::new();
    let data = pattern(80, 1_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    fx.group("g1", 1_000, &[a, b]);
    run_cfg(&fx.cfg());
    let out = fx.out();
    assert_eq!(fs::metadata(&out).unwrap().permissions().mode() & 0o777, 0o700);
    for e in fs::read_dir(&out).unwrap() {
        let m = e.unwrap().metadata().unwrap();
        assert_eq!(m.permissions().mode() & 0o077, 0, "group/other cannot read outputs");
    }
}

#[test]
fn candidates_are_never_modified() {
    let mut fx = Fx::new();
    let data = pattern(90, 150_000);
    let a = fx.write("a", &data);
    let b = fx.write("b", &data);
    fx.group("g1", 150_000, &[a.clone(), b.clone()]);
    let before: Vec<_> = [&a, &b].iter().map(|p| {
        let m = fs::metadata(p).unwrap();
        (m.ino(), m.len(), m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec(), m.mode())
    }).collect();
    let mut cfg = fx.cfg();
    cfg.settings.byte_verify = true;
    run_cfg(&cfg);
    let after: Vec<_> = [&a, &b].iter().map(|p| {
        let m = fs::metadata(p).unwrap();
        (m.ino(), m.len(), m.mtime(), m.mtime_nsec(), m.ctime(), m.ctime_nsec(), m.mode())
    }).collect();
    assert_eq!(before, after);
    assert_eq!(fs::read(&a).unwrap(), data);
    assert_eq!(fs::read(&b).unwrap(), data);
}

#[test]
fn plan_estimates_without_reading_files() {
    let mut fx = Fx::new();
    fx.group("g1", 1 << 30, &["/nonexistent/a".into(), "/nonexistent/b".into(), "/nonexistent/c".into()]);
    let p = run::plan(&fx.input(), &settings()).unwrap();
    assert_eq!(p.groups, 1);
    assert_eq!(p.files, 3);
    assert_eq!(p.full_bytes_max, 3 << 30);
    assert_eq!(p.sample_bytes_max, 3 * 3 * 4096);
    assert_eq!(p.potential_bytes_upper_bound, 2 << 30);
}
