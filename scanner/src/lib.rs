pub mod models;
pub mod scanner;
pub mod writer;
pub mod utils;

pub use models::{FileEntry, ScanOptions, ScanStats};
pub use scanner::{Scanner, scan_directory};
pub use writer::{ParquetFileWriter, write_to_parquet};
