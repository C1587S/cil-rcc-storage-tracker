//! One verification run: stream candidate groups through a bounded worker
//! pool, append results and cache entries as they complete, and write a
//! summary. `results.jsonl` doubles as the checkpoint: groups already
//! recorded as complete, skipped or deferred are not read again on resume;
//! incomplete groups are retried. When a group appears more than once, the
//! last line is authoritative.

use crate::cache::{CacheWriter, HashCache};
use crate::io::{IoGovernor, SIGNALLED};
use crate::model::*;
use crate::verify::{process_group, BlockHook, Ctx, Settings};
use crossbeam_channel::{bounded, RecvTimeoutError};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const RESULTS_FILE: &str = "results.jsonl";
pub const CACHE_FILE: &str = "hash-cache.jsonl";

pub struct RunConfig {
    pub input: PathBuf,
    pub out_dir: PathBuf,
    /// Defaults to `<out_dir>/hash-cache.jsonl`.
    pub cache_path: Option<PathBuf>,
    pub workers: usize,
    pub max_read_bytes_s: Option<f64>,
    pub budget_bytes: Option<u64>,
    pub settings: Settings,
    pub resume: bool,
    pub progress: bool,
    /// Extra stop flag (tests, embedding); SIGINT/SIGTERM always apply.
    pub stop_flag: Option<Arc<AtomicBool>>,
}

impl RunConfig {
    pub fn new(input: impl Into<PathBuf>, out_dir: impl Into<PathBuf>) -> Self {
        RunConfig {
            input: input.into(), out_dir: out_dir.into(), cache_path: None, workers: 2,
            max_read_bytes_s: None, budget_bytes: None, settings: Settings::default(),
            resume: true, progress: false, stop_flag: None,
        }
    }
}

/// One line of results.jsonl.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultLine {
    pub run_id: String,
    pub verified_at: String,
    #[serde(flatten)]
    pub result: GroupResult,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SettingsOut {
    pub workers: usize,
    pub max_read_bytes_s: Option<f64>,
    pub budget_bytes: Option<u64>,
    pub sample_block: u64,
    pub samples: u64,
    pub read_block: u64,
    pub byte_verify: bool,
    pub max_group_files: usize,
    pub prefixes: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Summary {
    pub tool: String,
    pub run_id: String,
    pub started_at: String,
    pub finished_at: String,
    pub elapsed_s: f64,
    pub settings: SettingsOut,
    /// "budget" or "interrupted" when the run stopped early.
    pub stopped: Option<String>,
    pub input_errors: u64,
    pub groups_already_done: u64,
    pub groups_complete: u64,
    pub groups_incomplete: u64,
    pub groups_deferred: u64,
    pub groups_skipped: u64,
    /// Read from the input but not attempted because the run stopped.
    pub groups_not_attempted: u64,
    pub files_in: u64,
    pub hardlink_paths: u64,
    pub inodes_examined: u64,
    pub unique_inodes: u64,
    pub groups_with_duplicates: u64,
    pub duplicate_sets: u64,
    pub duplicate_inodes: u64,
    pub sets_with_external_links: u64,
    /// Sum over verified sets of (copies - 1) * size.
    pub verified_logical_bytes: u64,
    /// Same, using allocated blocks (sparse-aware). Still an upper bound.
    pub verified_allocated_bytes: u64,
    pub skipped_by_reason: BTreeMap<String, u64>,
    pub io: IoCounts,
    pub bytes_read: u64,
    pub read_mib_s: f64,
    /// Complete groups (>= 2 inodes examined) with at least one verified set.
    pub confirmation_rate_groups: Option<f64>,
    /// Inodes in verified sets / inodes examined in complete groups.
    pub confirmation_rate_inodes: Option<f64>,
    pub cache_entries_loaded: usize,
    pub cache_entries_written: u64,
}

/// SIGINT/SIGTERM set a flag; workers finish their current read and the
/// interrupted groups are recorded as incomplete. (Slurm sends SIGTERM
/// before the time limit; give the job a --signal margin.)
pub fn install_signal_handlers() {
    extern "C" fn on_signal(_: libc::c_int) {
        SIGNALLED.store(true, Ordering::SeqCst);
    }
    unsafe {
        let mut sa: libc::sigaction = std::mem::zeroed();
        sa.sa_sigaction = on_signal as extern "C" fn(libc::c_int) as usize;
        libc::sigemptyset(&mut sa.sa_mask);
        libc::sigaction(libc::SIGINT, &sa, std::ptr::null_mut());
        libc::sigaction(libc::SIGTERM, &sa, std::ptr::null_mut());
    }
}

fn utc(secs: i64) -> (i64, i64, i64, i64, i64, i64) {
    // Civil-from-days (H. Hinnant), avoiding a date dependency.
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}

pub fn iso_now() -> String {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let (y, mo, d, h, mi, se) = utc(s);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{se:02}Z")
}

fn new_run_id() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let (y, mo, d, h, mi, se) = utc(now.as_secs() as i64);
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{se:02}Z-{:05x}", (now.subsec_nanos() ^ std::process::id()) & 0xfffff)
}

fn open_private_append(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().create(true).append(true).mode(0o600).open(path)
}

/// Group ids whose latest recorded status needs no further work.
pub fn finished_groups(results: &Path) -> std::io::Result<HashSet<String>> {
    #[derive(Deserialize)]
    struct Done {
        group_id: String,
        status: GroupStatus,
    }
    let mut latest: HashMap<String, GroupStatus> = HashMap::new();
    if results.exists() {
        for line in BufReader::new(File::open(results)?).lines() {
            if let Ok(d) = serde_json::from_str::<Done>(&line?) {
                latest.insert(d.group_id, d.status);
            }
        }
    }
    Ok(latest.into_iter().filter(|(_, s)| *s != GroupStatus::Incomplete).map(|(g, _)| g).collect())
}

fn reason_key(r: SkipReason) -> String {
    serde_json::to_string(&r).unwrap().trim_matches('"').to_string()
}

fn tally(sum: &mut Summary, r: &GroupResult) {
    match r.status {
        GroupStatus::Complete => sum.groups_complete += 1,
        GroupStatus::Incomplete => sum.groups_incomplete += 1,
        GroupStatus::Deferred => sum.groups_deferred += 1,
        GroupStatus::Skipped => sum.groups_skipped += 1,
    }
    sum.files_in += r.files_in as u64;
    sum.hardlink_paths += r.hardlink_paths as u64;
    for s in &r.skipped {
        *sum.skipped_by_reason.entry(reason_key(s.reason)).or_default() += 1;
    }
    sum.io.add(&r.io);
    if r.status != GroupStatus::Complete {
        return;
    }
    sum.inodes_examined += r.inodes_examined as u64;
    sum.unique_inodes += r.unique_inodes as u64;
    if !r.duplicate_sets.is_empty() {
        sum.groups_with_duplicates += 1;
    }
    for d in &r.duplicate_sets {
        sum.duplicate_sets += 1;
        sum.duplicate_inodes += d.copies as u64;
        sum.verified_logical_bytes += d.potential_logical_bytes;
        sum.verified_allocated_bytes += d.potential_allocated_bytes;
        if d.external_links {
            sum.sets_with_external_links += 1;
        }
    }
}

pub fn run(cfg: &RunConfig, hook: Option<BlockHook>) -> std::io::Result<Summary> {
    let t0 = Instant::now();
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&cfg.out_dir)?;
    let results_path = cfg.out_dir.join(RESULTS_FILE);
    let cache_path = cfg.cache_path.clone().unwrap_or_else(|| cfg.out_dir.join(CACHE_FILE));

    let done = if cfg.resume { finished_groups(&results_path)? } else { HashSet::new() };
    let cache = RwLock::new(HashCache::load(&cache_path)?);
    let mut gov = IoGovernor::new(cfg.max_read_bytes_s, cfg.budget_bytes);
    if let Some(f) = &cfg.stop_flag {
        gov = gov.with_stop_flag(f.clone());
    }
    let workers = cfg.workers.max(1);
    let s = &cfg.settings;

    let mut sum = Summary {
        tool: format!("cil-dupverify {}", env!("CARGO_PKG_VERSION")),
        run_id: new_run_id(),
        started_at: iso_now(),
        settings: SettingsOut {
            workers, max_read_bytes_s: cfg.max_read_bytes_s, budget_bytes: cfg.budget_bytes,
            sample_block: s.sample_block, samples: s.samples, read_block: s.read_block,
            byte_verify: s.byte_verify, max_group_files: s.max_group_files, prefixes: s.prefixes.clone(),
        },
        cache_entries_loaded: cache.read().unwrap().len(),
        ..Default::default()
    };

    let mut results = BufWriter::new(open_private_append(&results_path)?);
    let mut cache_w = CacheWriter::open(&cache_path)?;
    let input = BufReader::new(File::open(&cfg.input)?);

    let not_attempted = AtomicU64::new(0);
    let already_done = AtomicU64::new(0);
    let input_errors = AtomicU64::new(0);
    let ctx = Ctx { settings: s, gov: &gov, cache: &cache, hook };

    let write_result: std::io::Result<()> = std::thread::scope(|scope| {
        let (work_tx, work_rx) = bounded::<CandidateGroup>(workers * 2);
        let (res_tx, res_rx) = bounded::<(GroupResult, Vec<crate::cache::CacheEntry>)>(workers * 2);

        // Reader: streams the candidate file; memory stays bounded by the channel.
        let (gov_r, done_r, na, ad, ie) = (&gov, &done, &not_attempted, &already_done, &input_errors);
        scope.spawn(move || {
            for line in input.lines() {
                let Ok(line) = line else { ie.fetch_add(1, Ordering::Relaxed); break };
                if line.trim().is_empty() {
                    continue;
                }
                if gov_r.halted().is_some() {
                    na.fetch_add(1, Ordering::Relaxed);
                    continue;
                }
                match serde_json::from_str::<CandidateGroup>(&line) {
                    Ok(g) if done_r.contains(&g.group_id) => { ad.fetch_add(1, Ordering::Relaxed); }
                    Ok(g) => {
                        if work_tx.send(g).is_err() {
                            break;
                        }
                    }
                    Err(_) => { ie.fetch_add(1, Ordering::Relaxed); }
                }
            }
        });

        for _ in 0..workers {
            let (rx, tx, ctx, na) = (work_rx.clone(), res_tx.clone(), &ctx, &not_attempted);
            scope.spawn(move || {
                for g in rx.iter() {
                    if ctx.gov.halted().is_some() {
                        na.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    if tx.send(process_group(&g, ctx)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(work_rx);
        drop(res_tx);

        // Writer (this thread): every finished group is appended immediately,
        // so an interrupted run loses at most the groups in flight.
        let mut last_progress = Instant::now();
        let mut since_sync = 0u32;
        loop {
            match res_rx.recv_timeout(Duration::from_secs(1)) {
                Ok((r, entries)) => {
                    for e in &entries {
                        cache_w.append(e)?;
                        cache.write().unwrap().insert(e);
                    }
                    sum.cache_entries_written += entries.len() as u64;
                    tally(&mut sum, &r);
                    let line = ResultLine { run_id: sum.run_id.clone(), verified_at: iso_now(), result: r };
                    serde_json::to_writer(&mut results, &line)?;
                    results.write_all(b"\n")?;
                    results.flush()?;
                    since_sync += 1;
                    if since_sync >= 50 {
                        results.get_ref().sync_data()?;
                        cache_w.flush()?;
                        since_sync = 0;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if cfg.progress && last_progress.elapsed() >= Duration::from_secs(15) {
                last_progress = Instant::now();
                let el = t0.elapsed().as_secs_f64().max(1e-9);
                eprintln!(
                    "[dupverify] groups done={} incomplete={} | sets={} | read {:.2} GiB ({:.1} MiB/s) | {:.0}s",
                    sum.groups_complete + sum.groups_skipped + sum.groups_deferred, sum.groups_incomplete,
                    sum.duplicate_sets, gov.used() as f64 / (1u64 << 30) as f64,
                    sum.io.total() as f64 / el / (1u64 << 20) as f64, el
                );
            }
        }
        Ok(())
    });
    write_result?;
    results.flush()?;
    results.get_ref().sync_data()?;
    cache_w.flush()?;

    sum.groups_not_attempted = not_attempted.load(Ordering::Relaxed);
    sum.groups_already_done = already_done.load(Ordering::Relaxed);
    sum.input_errors = input_errors.load(Ordering::Relaxed);
    sum.stopped = gov.halted().map(|h| match h {
        crate::io::Halt::Budget => "budget".into(),
        crate::io::Halt::Interrupted => "interrupted".into(),
    });
    sum.elapsed_s = t0.elapsed().as_secs_f64();
    sum.bytes_read = sum.io.total();
    sum.read_mib_s = sum.bytes_read as f64 / sum.elapsed_s.max(1e-9) / (1u64 << 20) as f64;
    let comparable = sum.groups_complete; // complete groups always had >= 2 inodes
    sum.confirmation_rate_groups = (comparable > 0).then(|| sum.groups_with_duplicates as f64 / comparable as f64);
    sum.confirmation_rate_inodes =
        (sum.inodes_examined > 0).then(|| sum.duplicate_inodes as f64 / sum.inodes_examined as f64);
    sum.finished_at = iso_now();

    let mut f = OpenOptions::new().create(true).write(true).truncate(true).mode(0o600)
        .open(cfg.out_dir.join(format!("summary-{}.json", sum.run_id)))?;
    serde_json::to_writer_pretty(&mut f, &sum)?;
    f.write_all(b"\n")?;
    Ok(sum)
}

/// Read-only estimate of the work in a candidate file (no filesystem access).
#[derive(Debug, Default, Serialize)]
pub struct Plan {
    pub groups: u64,
    pub files: u64,
    pub truncated_groups: u64,
    pub groups_over_limit: u64,
    pub largest_group: u64,
    /// Upper bound on sample-stage reads (every file sampled once).
    pub sample_bytes_max: u64,
    /// Upper bound on full-hash reads (every file read completely).
    pub full_bytes_max: u64,
    /// (files - 1) * size summed: the unverified "potential" upper bound.
    pub potential_bytes_upper_bound: u64,
}

pub fn plan(input: &Path, s: &Settings) -> std::io::Result<Plan> {
    let mut p = Plan::default();
    for line in BufReader::new(File::open(input)?).lines() {
        let Ok(g) = serde_json::from_str::<CandidateGroup>(&line?) else { continue };
        let n = g.files.len() as u64;
        p.groups += 1;
        p.files += n;
        p.truncated_groups += g.truncated as u64;
        p.largest_group = p.largest_group.max(n);
        if g.files.len() > s.max_group_files {
            p.groups_over_limit += 1;
            continue;
        }
        p.sample_bytes_max += n * g.size.min(s.sample_block * s.samples);
        p.full_bytes_max += n * g.size;
        p.potential_bytes_upper_bound += n.saturating_sub(1) * g.size;
    }
    Ok(p)
}
