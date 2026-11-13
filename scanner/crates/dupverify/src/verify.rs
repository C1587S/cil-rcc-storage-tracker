//! Verification of one candidate group (files of one exact size).
//!
//! Stages, each run only on what the previous one could not rule out:
//!   0. lstat: drop symlinks, non-regular, missing, unreadable, resized
//!      files; collapse hard links (same device + inode) into one inode.
//!   1. Spread samples (or the full content for small files) per inode.
//!   2. Full BLAKE3 for inodes whose samples collide.
//!   3. Optional byte-for-byte comparison within each identical set.
//! Every read re-checks identity (fstat before and after); a file that
//! changes is excluded, never reported as verified.

use crate::cache::{self, CacheEntry, HashCache};
use crate::io::{self, FileId, Halt, IoGovernor, ReadError};
use crate::model::*;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::path::Path;
use std::sync::RwLock;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct Settings {
    pub sample_block: u64,
    pub samples: u64,
    pub read_block: u64,
    pub byte_verify: bool,
    pub max_group_files: usize,
    pub prefixes: Vec<String>,
}

impl Settings {
    pub fn sample_spec(&self) -> String {
        format!("{}x{}", self.sample_block, self.samples)
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings { sample_block: 64 * 1024, samples: 5, read_block: 1 << 20, byte_verify: false,
                   max_group_files: 50_000, prefixes: vec![] }
    }
}

/// Test hook: called with (path, bytes read so far) after each full-read block.
pub type BlockHook<'a> = &'a (dyn Fn(&str, u64) + Sync);

pub struct Ctx<'a> {
    pub settings: &'a Settings,
    pub gov: &'a IoGovernor,
    pub cache: &'a RwLock<HashCache>,
    pub hook: Option<BlockHook<'a>>,
}

struct Inode {
    id: FileId,
    paths: Vec<PathEntry>,
    sample: Option<String>,
    full: Option<String>,
}

enum Outcome {
    Skip(SkipReason),
    Halt(Halt),
}

fn reason_for(e: &std::io::Error) -> SkipReason {
    match e.kind() {
        std::io::ErrorKind::NotFound => SkipReason::Missing,
        std::io::ErrorKind::PermissionDenied => SkipReason::PermissionDenied,
        _ if e.raw_os_error() == Some(libc::ELOOP) => SkipReason::Symlink,
        _ => SkipReason::IoError,
    }
}

fn from_read(e: ReadError) -> Outcome {
    match e {
        ReadError::Io(e) => Outcome::Skip(reason_for(&e)),
        ReadError::Changed => Outcome::Skip(SkipReason::ChangedDuringRead),
        ReadError::Halt(h) => Outcome::Halt(h),
    }
}

fn in_scope(path: &str, prefixes: &[String]) -> bool {
    prefixes.is_empty() || prefixes.iter().any(|p| {
        let p = p.trim_end_matches('/');
        path == p || (path.starts_with(p) && path.as_bytes().get(p.len()) == Some(&b'/'))
    })
}

/// Open the representative path of an inode and confirm it is still the
/// same file version that was stat'ed (guards against swaps and edits).
fn open_checked(ino: &Inode, io_counts: &mut IoCounts) -> Result<File, Outcome> {
    let (f, _noatime) = io::open_readonly(Path::new(&ino.paths[0].path))
        .map_err(|e| Outcome::Skip(reason_for(&e)))?;
    io_counts.files_opened += 1;
    let now = FileId::from_meta(&f.metadata().map_err(|e| Outcome::Skip(reason_for(&e)))?);
    if !now.same_content_version(&ino.id) {
        return Err(Outcome::Skip(SkipReason::ChangedDuringRead));
    }
    Ok(f)
}

fn unchanged_after(f: &File, ino: &Inode) -> Result<(), Outcome> {
    let after = FileId::from_meta(&f.metadata().map_err(|e| Outcome::Skip(reason_for(&e)))?);
    if after.same_content_version(&ino.id) { Ok(()) } else { Err(Outcome::Skip(SkipReason::ChangedDuringRead)) }
}

fn full_hash(ino: &Inode, size: u64, ctx: &Ctx, io_counts: &mut IoCounts) -> Result<String, Outcome> {
    let f = open_checked(ino, io_counts)?;
    let path = ino.paths[0].path.clone();
    let mut hook = |off: u64| { if let Some(h) = ctx.hook { h(&path, off) } };
    let d = io::full_digest(&f, size, ctx.settings.read_block, ctx.gov, &mut io_counts.full_bytes, &mut hook)
        .map_err(from_read)?;
    unchanged_after(&f, ino)?;
    Ok(io::hex(&d))
}

pub fn process_group(g: &CandidateGroup, ctx: &Ctx) -> (GroupResult, Vec<CacheEntry>) {
    let t0 = Instant::now();
    let s = ctx.settings;
    let mut res = GroupResult {
        group_id: g.group_id.clone(), size: g.size, status: GroupStatus::Complete,
        files_in: g.files.len(), common_dir: common_dir(g), inodes_examined: 0, unique_inodes: 0, hardlink_paths: 0,
        duplicate_sets: vec![], skipped: vec![], io: IoCounts::default(), elapsed_ms: 0, note: None,
    };
    let mut new_cache: Vec<CacheEntry> = vec![];
    let done = |mut r: GroupResult, c: Vec<CacheEntry>| {
        r.elapsed_ms = t0.elapsed().as_millis() as u64;
        (r, c)
    };

    if g.size == 0 {
        res.status = GroupStatus::Skipped;
        res.skipped = g.files.iter().map(|f| Skipped { path: f.path.clone(), reason: SkipReason::ZeroSize }).collect();
        res.note = Some("zero-size files hold no data; not compared".into());
        return done(res, new_cache);
    }
    if g.files.len() > s.max_group_files {
        res.status = GroupStatus::Deferred;
        res.note = Some(format!("{} files exceeds --max-group-files {}; not attempted", g.files.len(), s.max_group_files));
        return done(res, new_cache);
    }

    // ---- stage 0: identity -------------------------------------------------
    let mut inodes: Vec<Inode> = vec![];
    let mut by_id: HashMap<(u64, u64), usize> = HashMap::new();
    for f in &g.files {
        if !in_scope(&f.path, &s.prefixes) {
            res.skipped.push(Skipped { path: f.path.clone(), reason: SkipReason::OutOfScope });
            continue;
        }
        let reason = match fs::symlink_metadata(&f.path) {
            Err(e) => Some(reason_for(&e)),
            Ok(m) if m.file_type().is_symlink() => Some(SkipReason::Symlink),
            Ok(m) if !m.is_file() => Some(SkipReason::NotRegular),
            Ok(m) => {
                let id = FileId::from_meta(&m);
                if id.size != g.size {
                    Some(SkipReason::SizeChanged)
                } else {
                    let pe = PathEntry { path: f.path.clone(), owner: f.owner.clone() };
                    match by_id.get(&(id.dev, id.ino)) {
                        Some(&i) => { inodes[i].paths.push(pe); res.hardlink_paths += 1; }
                        None => {
                            by_id.insert((id.dev, id.ino), inodes.len());
                            inodes.push(Inode { id, paths: vec![pe], sample: None, full: None });
                        }
                    }
                    None
                }
            }
        };
        if let Some(r) = reason {
            res.skipped.push(Skipped { path: f.path.clone(), reason: r });
        }
    }
    if inodes.len() < 2 {
        res.status = GroupStatus::Skipped;
        res.unique_inodes = inodes.len();
        res.note = Some("fewer than two distinct files (hard links are one file)".into());
        return done(res, new_cache);
    }

    let halt = |mut r: GroupResult, h: Halt, inodes: &[Inode], c: Vec<CacheEntry>| {
        let reason = match h { Halt::Budget => SkipReason::BudgetExhausted, Halt::Interrupted => SkipReason::Interrupted };
        r.status = GroupStatus::Incomplete;
        r.duplicate_sets.clear();
        for ino in inodes {
            for p in &ino.paths {
                r.skipped.push(Skipped { path: p.path.clone(), reason });
            }
        }
        let why = match h { Halt::Budget => "I/O budget reached", Halt::Interrupted => "interrupted" };
        r.note = Some(format!("stopped: {why}; nothing in this group counts as verified"));
        done(r, c)
    };

    // ---- stage 1: samples (or whole content when small) ------------------
    let spec = s.sample_spec();
    let whole = io::fully_sampled(g.size, s.sample_block, s.samples);
    let mut excluded = vec![false; inodes.len()];
    for i in 0..inodes.len() {
        let (cached_full, cached_sample) = {
            let c = ctx.cache.read().unwrap();
            (if whole { c.full(&inodes[i].id) } else { None }, c.sample(&inodes[i].id, &spec))
        };
        if whole {
            if let Some(h) = cached_full {
                res.io.cache_hits += 1;
                inodes[i].full = Some(h.clone());
                inodes[i].sample = Some(format!("full:{h}"));
                continue;
            }
            match full_hash(&inodes[i], g.size, ctx, &mut res.io) {
                Ok(h) => {
                    new_cache.push(cache::entry(&inodes[i].id, Some(h.clone()), None));
                    inodes[i].sample = Some(format!("full:{h}"));
                    inodes[i].full = Some(h);
                }
                Err(Outcome::Skip(r)) => { excluded[i] = true; skip_inode(&mut res, &inodes[i], r); }
                Err(Outcome::Halt(h)) => return halt(res, h, &inodes, new_cache),
            }
            continue;
        }
        if let Some(sm) = cached_sample {
            res.io.cache_hits += 1;
            inodes[i].sample = Some(sm);
            continue;
        }
        let r = open_checked(&inodes[i], &mut res.io).and_then(|f| {
            let d = io::sample_digest(&f, g.size, s.sample_block, s.samples, ctx.gov, &mut res.io.sample_bytes)
                .map_err(from_read)?;
            unchanged_after(&f, &inodes[i])?;
            Ok(io::hex(&d))
        });
        match r {
            Ok(h) => {
                new_cache.push(cache::entry(&inodes[i].id, None, Some((spec.clone(), h.clone()))));
                inodes[i].sample = Some(h);
            }
            Err(Outcome::Skip(r)) => { excluded[i] = true; skip_inode(&mut res, &inodes[i], r); }
            Err(Outcome::Halt(h)) => return halt(res, h, &inodes, new_cache),
        }
    }

    let mut buckets: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, ino) in inodes.iter().enumerate() {
        if !excluded[i] {
            buckets.entry(ino.sample.clone().expect("sampled")).or_default().push(i);
        }
    }
    res.inodes_examined = buckets.values().map(|v| v.len()).sum();

    // ---- stage 2: full content for colliding samples -----------------------
    let mut by_full: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for members in buckets.values() {
        if members.len() < 2 {
            res.unique_inodes += 1;
            continue;
        }
        for &i in members {
            if inodes[i].full.is_none() {
                if let Some(h) = ctx.cache.read().unwrap().full(&inodes[i].id) {
                    res.io.cache_hits += 1;
                    inodes[i].full = Some(h);
                }
            }
            if inodes[i].full.is_none() {
                match full_hash(&inodes[i], g.size, ctx, &mut res.io) {
                    Ok(h) => {
                        new_cache.push(cache::entry(&inodes[i].id, Some(h.clone()), Some((spec.clone(), inodes[i].sample.clone().unwrap()))));
                        inodes[i].full = Some(h);
                    }
                    Err(Outcome::Skip(r)) => { res.inodes_examined -= 1; skip_inode(&mut res, &inodes[i], r); continue; }
                    Err(Outcome::Halt(h)) => return halt(res, h, &inodes, new_cache),
                }
            }
            by_full.entry(inodes[i].full.clone().unwrap()).or_default().push(i);
        }
    }

    // ---- stage 3: optional byte comparison; build sets -----------------------
    for (hash, mut members) in by_full {
        if members.len() < 2 {
            res.unique_inodes += members.len();
            continue;
        }
        let mut byte_verified = false;
        if s.byte_verify {
            let reference = members[0];
            let mut kept = vec![reference];
            for &i in &members[1..] {
                let cmp = open_checked(&inodes[reference], &mut res.io).and_then(|a| {
                    let b = open_checked(&inodes[i], &mut res.io)?;
                    let eq = io::byte_equal(&a, &b, g.size, s.read_block, ctx.gov, &mut res.io.compare_bytes)
                        .map_err(from_read)?;
                    unchanged_after(&a, &inodes[reference])?;
                    unchanged_after(&b, &inodes[i])?;
                    Ok(eq)
                });
                match cmp {
                    Ok(true) => kept.push(i),
                    Ok(false) => res.unique_inodes += 1, // would need a BLAKE3 collision; reported, not trusted
                    Err(Outcome::Skip(r)) => skip_inode(&mut res, &inodes[i], r),
                    Err(Outcome::Halt(h)) => return halt(res, h, &inodes, new_cache),
                }
            }
            members = kept;
            byte_verified = true;
            if members.len() < 2 {
                res.unique_inodes += members.len();
                continue;
            }
        }
        let mut entries: Vec<InodeEntry> = members.iter().map(|&i| {
            let ino = &inodes[i];
            InodeEntry { dev: ino.id.dev, ino: ino.id.ino, nlink: ino.id.nlink,
                         allocated_bytes: ino.id.allocated, sparse: ino.id.allocated < ino.id.size,
                         paths: ino.paths.clone() }
        }).collect();
        entries.sort_by(|a, b| b.allocated_bytes.cmp(&a.allocated_bytes).then(a.paths[0].path.cmp(&b.paths[0].path)));
        let copies = entries.len();
        let alloc_total: u64 = entries.iter().map(|e| e.allocated_bytes).sum();
        let external = entries.iter().any(|e| e.nlink as usize > e.paths.len());
        res.duplicate_sets.push(DuplicateSet {
            blake3: hash, byte_verified, copies,
            potential_logical_bytes: (copies as u64 - 1) * g.size,
            potential_allocated_bytes: alloc_total - entries[0].allocated_bytes,
            external_links: external, inodes: entries,
        });
    }
    if g.truncated {
        res.note = Some("candidate export truncated this group; results cover the listed files only".into());
    }
    done(res, new_cache)
}

/// Deepest directory that contains every file of the group.
pub fn common_dir(g: &CandidateGroup) -> String {
    let mut iter = g.files.iter().map(|f| {
        let p = f.path.as_str();
        &p[..p.rfind('/').unwrap_or(0)]
    });
    let Some(first) = iter.next() else { return String::new() };
    let mut parts: Vec<&str> = first.split('/').collect();
    for dir in iter {
        let n = parts.iter().zip(dir.split('/')).take_while(|(a, b)| *a == b).count();
        parts.truncate(n);
    }
    let d = parts.join("/");
    if d.is_empty() && first.starts_with('/') { "/".into() } else { d }
}

fn skip_inode(res: &mut GroupResult, ino: &Inode, reason: SkipReason) {
    for p in &ino.paths {
        res.skipped.push(Skipped { path: p.path.clone(), reason });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(paths: &[&str]) -> CandidateGroup {
        CandidateGroup { group_id: "x".into(), size: 1, truncated: false,
                         files: paths.iter().map(|p| CandidateFile { path: p.to_string(), owner: None }).collect() }
    }

    #[test]
    fn common_dir_is_component_wise() {
        assert_eq!(common_dir(&g(&["/a/lab1/x/f", "/a/lab1/y/f"])), "/a/lab1");
        assert_eq!(common_dir(&g(&["/a/lab1/f", "/a/lab10/f"])), "/a", "not a string prefix");
        assert_eq!(common_dir(&g(&["/a/b/f"])), "/a/b");
        assert_eq!(common_dir(&g(&["/x/f", "/y/f"])), "/");
    }

    #[test]
    fn prefix_scope_respects_component_boundaries() {
        let p = vec!["/a/lab1/".to_string()];
        assert!(in_scope("/a/lab1/f", &p));
        assert!(!in_scope("/a/lab10/f", &p));
    }
}
