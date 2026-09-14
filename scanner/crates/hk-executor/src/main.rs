//! Housekeeping executor. See docs/manifest-format.md for the contract.
//!
//! Safety properties, in priority order:
//! 1. Runs as the file owner — refuses outright (before acting) if any
//!    manifest entry is owned by someone else.
//! 2. Dry-run is the default; acting requires --quarantine or --purge.
//! 3. Every entry is verified (lstat size + mtime seconds) against the
//!    manifest before being touched; changed files are skipped and logged.
//! 4. No symlink following, no recursion, no globbing; entries must
//!    resolve under the declared root.
//! 5. Bounded parallelism (--workers, default 16).
//! 6. Files first, then empty directories bottom-up (rmdir only).

use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use manifest_types::{Manifest, Outcome, Receipt, ReceiptEntry, FORMAT_VERSION};
use rayon::prelude::*;

#[derive(Parser)]
#[command(name = "hk-executor", about = "Execute a housekeeping manifest (dry-run by default)")]
struct Args {
    /// Manifest JSON produced by the housekeeping panel
    #[arg(long)]
    manifest: PathBuf,
    /// Rename files into the manifest's quarantine directory (reversible)
    #[arg(long)]
    quarantine: bool,
    /// Unlink files for real. Mutually exclusive with --quarantine.
    #[arg(long)]
    purge: bool,
    /// Purge a QUARANTINE: unlink the held copies of this manifest's files
    /// (at quarantine_dir + relative path — where --quarantine moved them).
    /// Refuses before the 30-day grace expires unless --force.
    #[arg(long)]
    purge_quarantine: bool,
    /// Override the grace-period refusal for --purge-quarantine.
    #[arg(long)]
    force: bool,
    /// Preview any mode without touching the filesystem.
    #[arg(long)]
    dry_run: bool,
    /// Bounded parallelism. Unlink storms hurt the metadata servers for
    /// the whole cluster — keep this modest.
    #[arg(long, default_value_t = 16)]
    workers: usize,
    /// Act on files you do NOT own, where directory permissions allow it
    /// (POSIX: unlink is governed by the parent directory's write bit, not
    /// file ownership). Files in non-writable directories are skipped and
    /// reported as skipped_no_access. Without this flag the executor
    /// refuses foreign-owned files outright.
    #[arg(long)]
    delegate: bool,
    /// Receipt output path (default: <manifest_id>.receipt.json)
    #[arg(long)]
    receipt: Option<PathBuf>,
}

fn iso_now() -> String {
    // Seconds precision is plenty for a receipt
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let days = secs / 86400;
    let (mut y, mut rem) = (1970i64, days);
    loop {
        let len = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 366 } else { 365 };
        if rem < len { break; }
        rem -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let ml = [31, if leap {29} else {28}, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0;
    while rem >= ml[m] { rem -= ml[m]; m += 1; }
    let t = secs % 86400;
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m + 1, rem + 1, t / 3600, (t / 60) % 60, t % 60)
}

fn main() {
    let args = Args::parse();
    let modes = [args.quarantine, args.purge, args.purge_quarantine]
        .iter().filter(|m| **m).count();
    if modes > 1 {
        eprintln!("error: --quarantine, --purge and --purge-quarantine are mutually exclusive");
        std::process::exit(2);
    }
    let dry_run = modes == 0 || args.dry_run;
    let action = if args.purge_quarantine { "purge_quarantine" }
                 else if args.purge { "purge" } else { "quarantine" };

    // Manifests may be gzipped (.json.gz) — detect by magic, not name
    let raw_bytes = fs::read(&args.manifest).unwrap_or_else(|e| {
        eprintln!("error: cannot read manifest: {e}");
        std::process::exit(2);
    });
    let raw = if raw_bytes.starts_with(&[0x1f, 0x8b]) {
        use std::io::Read;
        let mut out = String::new();
        flate2::read::GzDecoder::new(&raw_bytes[..]).read_to_string(&mut out)
            .unwrap_or_else(|e| { eprintln!("error: bad gzip manifest: {e}"); std::process::exit(2) });
        out
    } else {
        String::from_utf8(raw_bytes).unwrap_or_else(|_| {
            eprintln!("error: manifest is neither gzip nor UTF-8 JSON");
            std::process::exit(2);
        })
    };
    let manifest: Manifest = serde_json::from_str(&raw).unwrap_or_else(|e| {
        eprintln!("error: manifest does not parse as format v{FORMAT_VERSION}: {e}");
        std::process::exit(2);
    });
    if manifest.version != FORMAT_VERSION {
        eprintln!("error: manifest version {} unsupported (executor speaks v{FORMAT_VERSION})", manifest.version);
        std::process::exit(2);
    }

    let me = unsafe { libc::geteuid() };
    let root = Path::new(&manifest.root);
    let started_at = iso_now();

    rayon::ThreadPoolBuilder::new().num_threads(args.workers).build_global().ok();

    // ---- Pre-flight: confinement + ownership. Refuse rather than fail
    // halfway through with a pile of permission errors. ----
    let mut confinement_violations = 0u64;
    for e in &manifest.entries {
        let p = Path::new(&e.path);
        if !p.starts_with(root) || e.path.contains("/../") || e.path.ends_with("/..") {
            eprintln!("refused: {} resolves outside root {}", e.path, manifest.root);
            confinement_violations += 1;
        }
    }
    if confinement_violations > 0 {
        eprintln!("error: {confinement_violations} entries outside the declared root — refusing to run");
        std::process::exit(2);
    }
    if !args.delegate {
        let foreign: Vec<&str> = manifest.entries.par_iter()
            .filter_map(|e| {
                let p = if args.purge_quarantine { quarantine_path(&manifest, &e.path) } else { e.path.clone() };
                match fs::symlink_metadata(&p) {
                    Ok(md) if md.uid() != me => Some(e.path.as_str()),
                    _ => None,
                }
            })
            .collect();
        if !foreign.is_empty() && !dry_run {
            eprintln!("error: {} entries are not owned by uid {me} (first: {}) — refusing to run.",
                      foreign.len(), foreign[0]);
            eprintln!("This manifest belongs to '{}'; run it as that user,", manifest.owner_uname);
            eprintln!("or re-run with --delegate to act where directory permissions allow.");
            std::process::exit(2);
        }
    }

    // ---- Grace check for quarantine purges: ctime of the held files is
    // the moment they were renamed in; the newest one starts the clock. ----
    if args.purge_quarantine && !dry_run {
        const GRACE_SECS: i64 = 30 * 86400;
        let now = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let newest_ctime = manifest.entries.par_iter()
            .filter_map(|e| {
                let q = quarantine_path(&manifest, &e.path);
                fs::symlink_metadata(&q).ok().map(|md| md.ctime())
            })
            .max();
        if let Some(ct) = newest_ctime {
            let expiry = ct + GRACE_SECS;
            if now < expiry {
                let days_left = (expiry - now + 86399) / 86400;
                if args.force {
                    eprintln!("WARNING: grace period has {days_left} day(s) left — \
purging anyway because --force was given. These files become unrecoverable.");
                } else {
                    eprintln!("refusing: the 30-day grace period has {days_left} day(s) left \
(newest quarantine write). Re-run with --force to purge anyway.");
                    std::process::exit(2);
                }
            }
        }
    }

    // ---- File pass ----
    let delegate = args.delegate;
    let outcomes = Mutex::new(Vec::with_capacity(manifest.entries.len()));
    manifest.entries.par_iter().for_each(|e| {
        let out = process_entry(e, &manifest, dry_run, args.purge, me, delegate, args.purge_quarantine);
        outcomes.lock().unwrap().push(out);
    });
    let mut outcomes = outcomes.into_inner().unwrap();
    outcomes.sort_by(|a, b| a.path.cmp(&b.path));

    // ---- Directory pass: rmdir emptied ancestors, deepest first, never
    // the root itself. Only meaningful when files actually moved. ----
    let mut dirs_removed = 0u64;
    if !dry_run {
        let mut dirs: Vec<PathBuf> = outcomes.iter()
            .filter(|o| matches!(o.outcome, Outcome::Quarantined | Outcome::Deleted))
            .filter_map(|o| {
                let acted_on = if args.purge_quarantine {
                    PathBuf::from(quarantine_path(&manifest, &o.path))
                } else {
                    PathBuf::from(&o.path)
                };
                acted_on.parent().map(|p| p.to_path_buf())
            })
            .collect::<HashSet<_>>().into_iter().collect();
        dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
        for d in dirs {
            let mut cur = d;
            while cur.starts_with(root) && cur != root {
                match fs::remove_dir(&cur) {   // rmdir: fails unless empty
                    Ok(()) => { dirs_removed += 1; }
                    Err(_) => break,
                }
                match cur.parent() { Some(p) => cur = p.to_path_buf(), None => break }
            }
        }
    }

    // ---- Accounting: bytes freed once per inode ----
    let mut seen_inodes = HashSet::new();
    let mut bytes_freed = 0u64;
    let mut removed = 0u64;
    for (o, e) in outcomes.iter().zip(manifest.entries.iter()) {
        // outcomes sorted by path; entries ordered by owner,path from the
        // generator — re-pair via lookup instead
        let _ = (o, e);
    }
    let size_by_path: std::collections::HashMap<&str, (u64, u64)> = manifest.entries.iter()
        .map(|e| (e.path.as_str(), (e.size_bytes, e.inode))).collect();
    for o in &outcomes {
        if matches!(o.outcome, Outcome::Quarantined | Outcome::Deleted) {
            removed += 1;
            if let Some((sz, ino)) = size_by_path.get(o.path.as_str()) {
                if seen_inodes.insert(*ino) {
                    bytes_freed += sz;
                }
            }
        }
    }

    let (succeeded, exceptional): (Vec<_>, Vec<_>) = outcomes.into_iter()
        .partition(|o| matches!(o.outcome, Outcome::Quarantined | Outcome::Deleted));
    let receipt = Receipt {
        version: FORMAT_VERSION,
        manifest_id: manifest.manifest_id.clone(),
        executor: std::env::var("USER").unwrap_or_else(|_| me.to_string()),
        action: action.to_string(),
        dry_run,
        started_at,
        finished_at: iso_now(),
        bytes_freed,
        files_removed: removed,
        files_skipped_changed: exceptional.iter().filter(|o| o.outcome == Outcome::SkippedChanged).count() as u64,
        files_skipped_missing: exceptional.iter().filter(|o| o.outcome == Outcome::SkippedMissing).count() as u64,
        files_skipped_no_access: exceptional.iter().filter(|o| o.outcome == Outcome::SkippedNoAccess).count() as u64,
        files_failed: exceptional.iter().filter(|o| o.outcome == Outcome::Failed).count() as u64,
        dirs_removed,
        outcomes: exceptional,
        succeeded_paths: succeeded.into_iter().map(|o| o.path).collect(),
    };

    // Gzipped by default: a 400K-file receipt is ~100 MB plain, ~5 MB gz.
    let out_path = args.receipt.unwrap_or_else(|| PathBuf::from(format!("{}.receipt.json.gz", manifest.manifest_id)));
    let json = serde_json::to_string(&receipt).unwrap();
    if out_path.extension().map(|e| e == "gz").unwrap_or(false) {
        use std::io::Write;
        let f = fs::File::create(&out_path).expect("cannot write receipt");
        let mut enc = flate2::write::GzEncoder::new(f, flate2::Compression::default());
        enc.write_all(json.as_bytes()).expect("cannot write receipt");
        enc.finish().expect("cannot finish receipt");
    } else {
        fs::write(&out_path, &json).expect("cannot write receipt");
    }

    println!("{} run: {} removed ({} bytes freed), {} skipped-changed, {} skipped-missing, {} failed, {} dirs removed",
             if dry_run { "DRY" } else { action }, receipt.files_removed, receipt.bytes_freed,
             receipt.files_skipped_changed, receipt.files_skipped_missing, receipt.files_failed,
             receipt.dirs_removed);
    println!("receipt: {}", out_path.display());
    if receipt.files_failed > 0 { std::process::exit(1); }
}

fn parent_writable(path: &str) -> bool {
    // What actually governs unlink/rename: w+x on the containing directory.
    let parent = match Path::new(path).parent() {
        Some(p) => p,
        None => return false,
    };
    let c = match std::ffi::CString::new(parent.as_os_str().as_encoded_bytes()) {
        Ok(c) => c,
        Err(_) => return false,
    };
    unsafe { libc::access(c.as_ptr(), libc::W_OK | libc::X_OK) == 0 }
}

fn quarantine_path(m: &Manifest, original: &str) -> String {
    format!("{}{}", m.quarantine_dir, &original[m.root.len()..])
}

fn process_entry(e: &manifest_types::ManifestEntry, m: &Manifest, dry_run: bool,
                 purge: bool, me: u32, delegate: bool, purge_q: bool) -> ReceiptEntry {
    // In purge-quarantine mode we act on the held copy; the receipt still
    // names the ORIGINAL path, which is what the registry keys on.
    let target = if purge_q { quarantine_path(m, &e.path) } else { e.path.clone() };
    let md = match fs::symlink_metadata(&target) {
        Err(_) => return ReceiptEntry { path: e.path.clone(), outcome: Outcome::SkippedMissing, errno: None, nlink: 0 },
        Ok(md) => md,
    };
    let nlink = md.nlink();
    // A symlink, a size change or an mtime change means this is not the
    // file that was reviewed. Do not touch it.
    if md.file_type().is_symlink() || md.size() != e.size_bytes || md.mtime() != e.mtime_epoch {
        return ReceiptEntry { path: e.path.clone(), outcome: Outcome::SkippedChanged, errno: None, nlink };
    }
    if delegate {
        if !parent_writable(&target) {
            return ReceiptEntry { path: e.path.clone(), outcome: Outcome::SkippedNoAccess, errno: Some(libc::EACCES), nlink };
        }
    } else if md.uid() != me {
        return ReceiptEntry { path: e.path.clone(), outcome: Outcome::Failed, errno: Some(libc::EPERM), nlink };
    }
    let deleting = purge || purge_q;
    if dry_run {
        return ReceiptEntry { path: e.path.clone(), outcome: if deleting { Outcome::Deleted } else { Outcome::Quarantined }, errno: None, nlink };
    }
    let result = if deleting {
        fs::remove_file(&target)
    } else {
        let rel = &e.path[m.root.len()..];
        let dest = format!("{}{}", m.quarantine_dir, rel);
        let dest_p = Path::new(&dest);
        if let Some(parent) = dest_p.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                return ReceiptEntry { path: e.path.clone(), outcome: Outcome::Failed,
                                      errno: err.raw_os_error(), nlink };
            }
        }
        fs::rename(&e.path, dest_p)
    };
    match result {
        Ok(()) => ReceiptEntry { path: e.path.clone(),
                                 outcome: if deleting { Outcome::Deleted } else { Outcome::Quarantined },
                                 errno: None, nlink },
        Err(err) => ReceiptEntry { path: e.path.clone(), outcome: Outcome::Failed,
                                   errno: err.raw_os_error(), nlink },
    }
}
