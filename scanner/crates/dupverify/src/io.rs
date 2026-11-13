//! File identity, I/O governance (rate limit + total budget + stop flag) and
//! the three read paths: spread samples, full BLAKE3, byte-for-byte compare.
//! Everything here opens files read-only; nothing writes to candidates.

use std::fs::{File, Metadata, OpenOptions};
use std::io;
use std::os::unix::fs::{FileExt, MetadataExt, OpenOptionsExt};
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Set by the SIGINT/SIGTERM handler (Slurm sends SIGTERM before a time limit).
pub static SIGNALLED: AtomicBool = AtomicBool::new(false);

/// What makes a file "the same file" across stat calls and runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileId {
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub mtime_ns: i128,
    pub ctime_ns: i128,
    pub nlink: u64,
    pub allocated: u64,
}

impl FileId {
    pub fn from_meta(m: &Metadata) -> Self {
        FileId {
            dev: m.dev(),
            ino: m.ino(),
            size: m.len(),
            mtime_ns: m.mtime() as i128 * 1_000_000_000 + m.mtime_nsec() as i128,
            ctime_ns: m.ctime() as i128 * 1_000_000_000 + m.ctime_nsec() as i128,
            nlink: m.nlink(),
            allocated: m.blocks().saturating_mul(512),
        }
    }
    /// Same inode with unchanged size and timestamps (nlink may change).
    pub fn same_content_version(&self, o: &FileId) -> bool {
        self.dev == o.dev && self.ino == o.ino && self.size == o.size
            && self.mtime_ns == o.mtime_ns && self.ctime_ns == o.ctime_ns
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Halt {
    Budget,
    Interrupted,
}

#[derive(Debug)]
pub enum ReadError {
    Io(io::Error),
    Changed,
    Halt(Halt),
}

impl From<io::Error> for ReadError {
    fn from(e: io::Error) -> Self {
        ReadError::Io(e)
    }
}

/// Global limits shared by all workers.
pub struct IoGovernor {
    rate: Option<f64>,
    bucket: Mutex<(f64, Instant)>,
    budget: Option<u64>,
    used: AtomicU64,
    stop: AtomicBool,
    exhausted: AtomicBool,
    external: Option<Arc<AtomicBool>>,
}

impl IoGovernor {
    /// `rate_bytes_s`: sustained read rate cap; `budget_bytes`: total bytes this run may read.
    pub fn new(rate_bytes_s: Option<f64>, budget_bytes: Option<u64>) -> Self {
        IoGovernor {
            rate: rate_bytes_s.filter(|r| *r > 0.0),
            bucket: Mutex::new((0.0, Instant::now())),
            budget: budget_bytes,
            used: AtomicU64::new(0),
            stop: AtomicBool::new(false),
            exhausted: AtomicBool::new(false),
            external: None,
        }
    }

    /// Also stop when `flag` is set (used by tests and embedding callers
    /// instead of the process-wide signal flag).
    pub fn with_stop_flag(mut self, flag: Arc<AtomicBool>) -> Self {
        self.external = Some(flag);
        self
    }

    pub fn used(&self) -> u64 {
        self.used.load(Ordering::Relaxed)
    }

    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }

    /// Budget exhaustion is sticky: once a read would exceed the budget the
    /// whole run winds down, so the budget is a hard ceiling on bytes read.
    pub fn halted(&self) -> Option<Halt> {
        if SIGNALLED.load(Ordering::Relaxed) || self.stop.load(Ordering::Relaxed)
            || self.external.as_ref().is_some_and(|f| f.load(Ordering::Relaxed)) {
            return Some(Halt::Interrupted);
        }
        if self.exhausted.load(Ordering::Relaxed) {
            return Some(Halt::Budget);
        }
        None
    }

    /// Reserve `n` bytes before reading them: enforces the stop flag, the
    /// total budget, and the rate limit (token bucket, 1 s burst).
    pub fn acquire(&self, n: u64) -> Result<(), Halt> {
        if let Some(h) = self.halted() {
            return Err(h);
        }
        if let Some(b) = self.budget {
            let prev = self.used.fetch_add(n, Ordering::Relaxed);
            if prev + n > b {
                self.used.fetch_sub(n, Ordering::Relaxed);
                self.exhausted.store(true, Ordering::Relaxed);
                return Err(Halt::Budget);
            }
        } else {
            self.used.fetch_add(n, Ordering::Relaxed);
        }
        let Some(rate) = self.rate else { return Ok(()) };
        loop {
            let wait = {
                let mut g = self.bucket.lock().unwrap();
                let now = Instant::now();
                let refill = now.duration_since(g.1).as_secs_f64() * rate;
                g.0 = (g.0 + refill).min(rate.max(n as f64));
                g.1 = now;
                if g.0 >= n as f64 {
                    g.0 -= n as f64;
                    return Ok(());
                }
                (n as f64 - g.0) / rate
            };
            if let Some(h) = self.halted() {
                return Err(h);
            }
            std::thread::sleep(Duration::from_secs_f64(wait.min(0.5)));
        }
    }
}

/// Open read-only without following a symlink in the last component.
/// O_NOATIME keeps reads from marking cold files as recently accessed
/// (it is only permitted for the file's owner; otherwise retried without).
/// O_NONBLOCK keeps a path swapped for a FIFO or device after the lstat
/// from blocking the open; it has no effect on regular-file reads, and the
/// identity check that follows rejects anything that is not the stat'ed file.
pub fn open_readonly(path: &Path) -> io::Result<(File, bool)> {
    let base = libc::O_NOFOLLOW | libc::O_NONBLOCK;
    match OpenOptions::new().read(true).custom_flags(base | libc::O_NOATIME).open(path) {
        Ok(f) => Ok((f, true)),
        Err(e) if e.raw_os_error() == Some(libc::EPERM) => {
            let f = OpenOptions::new().read(true).custom_flags(base).open(path)?;
            Ok((f, false))
        }
        Err(e) => Err(e),
    }
}

fn advise(f: &File, advice: libc::c_int) {
    // Best effort: sequential readahead, then drop our pages from the cache
    // so a large verification does not evict other users' data.
    unsafe {
        libc::posix_fadvise(f.as_raw_fd(), 0, 0, advice);
    }
}

fn read_exact_at(f: &File, buf: &mut [u8], off: u64) -> Result<(), ReadError> {
    let mut done = 0usize;
    while done < buf.len() {
        let n = f.read_at(&mut buf[done..], off + done as u64)?;
        if n == 0 {
            return Err(ReadError::Changed); // shorter than expected: it changed
        }
        done += n;
    }
    Ok(())
}

/// Offsets of `count` blocks of `block` bytes spread evenly from the first to
/// the last byte. Spreading matters here: NetCDF/HDF5 outputs with the same
/// schema share identical headers and differ only in their data.
pub fn sample_offsets(size: u64, block: u64, count: u64) -> Vec<u64> {
    if size <= block * count || count <= 1 {
        return vec![0];
    }
    let last = size - block;
    (0..count).map(|i| last * i / (count - 1)).collect()
}

/// Files this small are hashed completely in the sample stage.
pub fn fully_sampled(size: u64, block: u64, count: u64) -> bool {
    size <= block * count
}

/// Digest of spread samples (keyed by size and offsets). Bytes are added
/// to `read` as they are read, so partial reads are accounted for too.
pub fn sample_digest(f: &File, size: u64, block: u64, count: u64, gov: &IoGovernor, read: &mut u64)
    -> Result<[u8; 32], ReadError> {
    let mut h = blake3::Hasher::new();
    h.update(b"cil-dupverify-sample-v1");
    h.update(&size.to_le_bytes());
    let mut buf = vec![0u8; block as usize];
    for off in sample_offsets(size, block, count) {
        let len = block.min(size - off) as usize;
        gov.acquire(len as u64).map_err(ReadError::Halt)?;
        let r = read_exact_at(f, &mut buf[..len], off);
        *read += len as u64;
        r?;
        h.update(&off.to_le_bytes());
        h.update(&buf[..len]);
    }
    Ok(*h.finalize().as_bytes())
}

/// Full-content BLAKE3. `on_block` is a test hook called after each block.
pub fn full_digest(f: &File, size: u64, block: u64, gov: &IoGovernor, read: &mut u64,
                   on_block: &mut dyn FnMut(u64)) -> Result<[u8; 32], ReadError> {
    advise(f, libc::POSIX_FADV_SEQUENTIAL);
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; block as usize];
    let mut off = 0u64;
    let result = (|| {
        while off < size {
            let len = block.min(size - off) as usize;
            gov.acquire(len as u64).map_err(ReadError::Halt)?;
            let r = read_exact_at(f, &mut buf[..len], off);
            *read += len as u64;
            r?;
            h.update(&buf[..len]);
            off += len as u64;
            on_block(off);
        }
        // Bytes beyond the expected size mean the file grew.
        let mut probe = [0u8; 1];
        if f.read_at(&mut probe, size)? != 0 {
            return Err(ReadError::Changed);
        }
        Ok(())
    })();
    advise(f, libc::POSIX_FADV_DONTNEED);
    result.map(|_| *h.finalize().as_bytes())
}

/// Byte-for-byte equality of two already-open files of `size` bytes.
pub fn byte_equal(a: &File, b: &File, size: u64, block: u64, gov: &IoGovernor, read: &mut u64)
    -> Result<bool, ReadError> {
    let mut ba = vec![0u8; block as usize];
    let mut bb = vec![0u8; block as usize];
    let mut off = 0u64;
    let result = (|| {
        while off < size {
            let len = block.min(size - off) as usize;
            gov.acquire(2 * len as u64).map_err(ReadError::Halt)?;
            let r = read_exact_at(a, &mut ba[..len], off).and_then(|_| read_exact_at(b, &mut bb[..len], off));
            *read += 2 * len as u64;
            r?;
            if ba[..len] != bb[..len] {
                return Ok(false);
            }
            off += len as u64;
        }
        Ok(true)
    })();
    advise(a, libc::POSIX_FADV_DONTNEED);
    advise(b, libc::POSIX_FADV_DONTNEED);
    result
}

pub fn hex(d: &[u8; 32]) -> String {
    d.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offsets_cover_first_and_last_block() {
        assert_eq!(sample_offsets(100, 64, 5), vec![0]);
        let o = sample_offsets(1_000_000, 4096, 5);
        assert_eq!(o.len(), 5);
        assert_eq!(o[0], 0);
        assert_eq!(*o.last().unwrap(), 1_000_000 - 4096);
        assert!(o.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn budget_is_a_hard_sticky_ceiling() {
        let g = IoGovernor::new(None, Some(100));
        assert!(g.acquire(60).is_ok());
        assert_eq!(g.acquire(50), Err(Halt::Budget));
        assert_eq!(g.used(), 60);
        // Even a read that would fit is refused once the budget was hit.
        assert_eq!(g.acquire(10), Err(Halt::Budget));
    }

    #[test]
    fn rate_limit_paces_reads() {
        let g = IoGovernor::new(Some(1_000_000.0), None);
        let t = Instant::now();
        for _ in 0..3 {
            g.acquire(1_000_000).unwrap();
        }
        // 1 s burst then ~1 s per MB.
        assert!(t.elapsed() >= Duration::from_millis(1500), "{:?}", t.elapsed());
    }

    #[test]
    fn opening_a_fifo_does_not_block() {
        let d = tempfile::TempDir::new().unwrap();
        let p = d.path().join("fifo");
        let c = std::ffi::CString::new(p.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0);
        let (f, _) = open_readonly(&p).expect("returns immediately");
        assert!(!f.metadata().unwrap().is_file());
    }

    #[test]
    fn stop_flag_halts() {
        let f = Arc::new(AtomicBool::new(false));
        let g = IoGovernor::new(None, None).with_stop_flag(f.clone());
        assert!(g.acquire(1).is_ok());
        f.store(true, Ordering::Relaxed);
        assert_eq!(g.acquire(1), Err(Halt::Interrupted));
    }
}
