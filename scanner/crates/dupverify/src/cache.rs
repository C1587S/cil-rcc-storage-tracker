//! Reusable digests.
//!
//! An entry is valid only for the exact same file version: device, inode,
//! size, mtime (ns) and ctime (ns). Any write, truncate, chmod/chown or
//! replacement changes ctime (which users cannot set), so a stale digest is
//! never reused; it is simply recomputed. Sample digests are additionally
//! tied to the sampling spec that produced them. The cache is an append-only
//! JSON Lines file (created 0600); later lines refine earlier ones.

use crate::io::FileId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CacheEntry {
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub mtime_ns: i128,
    pub ctime_ns: i128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blake3: Option<String>,
    /// Sampling parameters the sample digest was computed with, e.g. "64Kx5".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_spec: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
}

pub type Key = (u64, u64, u64, i128, i128);

pub fn key(id: &FileId) -> Key {
    (id.dev, id.ino, id.size, id.mtime_ns, id.ctime_ns)
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Cached {
    pub blake3: Option<String>,
    pub sample: Option<(String, String)>,
}

#[derive(Default)]
pub struct HashCache {
    map: HashMap<Key, Cached>,
}

impl HashCache {
    pub fn load(path: &Path) -> std::io::Result<Self> {
        let mut c = HashCache::default();
        if !path.exists() {
            return Ok(c);
        }
        for line in BufReader::new(File::open(path)?).lines() {
            if let Ok(e) = serde_json::from_str::<CacheEntry>(&line?) {
                c.insert(&e);
            }
        }
        Ok(c)
    }

    pub fn get(&self, id: &FileId) -> Option<&Cached> {
        self.map.get(&key(id))
    }

    /// Full hash, if known for this exact file version.
    pub fn full(&self, id: &FileId) -> Option<String> {
        self.get(id).and_then(|c| c.blake3.clone())
    }

    /// Sample digest, if known for this file version and sampling spec.
    pub fn sample(&self, id: &FileId, spec: &str) -> Option<String> {
        self.get(id).and_then(|c| c.sample.as_ref())
            .filter(|(s, _)| s == spec).map(|(_, h)| h.clone())
    }

    pub fn insert(&mut self, e: &CacheEntry) {
        let slot = self.map.entry((e.dev, e.ino, e.size, e.mtime_ns, e.ctime_ns)).or_default();
        if e.blake3.is_some() {
            slot.blake3 = e.blake3.clone();
        }
        if let (Some(spec), Some(s)) = (&e.sample_spec, &e.sample) {
            slot.sample = Some((spec.clone(), s.clone()));
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// Append-only writer for cache entries.
pub struct CacheWriter {
    f: File,
}

impl CacheWriter {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        let f = OpenOptions::new().create(true).append(true).mode(0o600).open(path)?;
        Ok(CacheWriter { f })
    }
    pub fn append(&mut self, e: &CacheEntry) -> std::io::Result<()> {
        let mut line = serde_json::to_string(e).expect("serializable");
        line.push('\n');
        self.f.write_all(line.as_bytes())
    }
    pub fn flush(&mut self) -> std::io::Result<()> {
        self.f.flush()?;
        self.f.sync_data()
    }
}

pub fn entry(id: &FileId, blake3: Option<String>, sample: Option<(String, String)>) -> CacheEntry {
    let (sample_spec, sample) = match sample {
        Some((spec, s)) => (Some(spec), Some(s)),
        None => (None, None),
    };
    CacheEntry { dev: id.dev, ino: id.ino, size: id.size, mtime_ns: id.mtime_ns, ctime_ns: id.ctime_ns,
                 blake3, sample_spec, sample }
}
