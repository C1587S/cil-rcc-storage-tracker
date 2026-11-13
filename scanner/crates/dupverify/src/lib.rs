//! Content verification of duplicate candidates.
//!
//! Input: candidate groups (files sharing an exact size) exported from the
//! metadata snapshot. Output: which of those files are byte-identical,
//! established by spread samples, then full BLAKE3, optionally followed by a
//! byte-for-byte comparison. The tool only ever opens candidate files
//! read-only; it never modifies, moves or deletes anything, and it does not
//! produce deletion actions. Deciding what to do with verified copies stays
//! in the Housekeeping review workflow.

pub mod cache;
pub mod io;
pub mod model;
pub mod run;
pub mod verify;
