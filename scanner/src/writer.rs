use crate::models::FileEntry;
use anyhow::{Context, Result};
use arrow::array::{
    ArrayRef, Int64Array, StringArray, UInt32Array, UInt64Array,
};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use crossbeam_channel::Receiver;
use parquet::arrow::ArrowWriter;
use parquet::basic::{Compression, Encoding};
use parquet::file::properties::WriterProperties;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;
use tracing::info;

/// Parquet writer for FileEntry records
pub struct ParquetFileWriter {
    writer: ArrowWriter<File>,
    schema: Arc<Schema>,
    rows_written: u64,
}

impl ParquetFileWriter {
    /// Create a new Parquet writer
    pub fn new<P: AsRef<Path>>(output_path: P) -> Result<Self> {
        let schema = Self::create_schema();
        let file = File::create(output_path.as_ref())
            .context("Failed to create output file")?;

        let props = WriterProperties::builder()
            .set_compression(Compression::SNAPPY)
            .set_encoding(Encoding::PLAIN)
            .set_dictionary_enabled(true)
            .set_max_row_group_size(100_000)  // Smaller row groups for faster visibility
            .build();

        let writer = ArrowWriter::try_new(file, schema.clone(), Some(props))
            .context("Failed to create Arrow writer")?;

        info!("Created Parquet writer for: {}", output_path.as_ref().display());

        Ok(Self {
            writer,
            schema,
            rows_written: 0,
        })
    }

    /// Create the Arrow schema for FileEntry
    fn create_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new("path", DataType::Utf8, false),
            Field::new("size", DataType::UInt64, false),
            Field::new("modified_time", DataType::Int64, false),
            Field::new("accessed_time", DataType::Int64, false),
            Field::new("created_time", DataType::Int64, true),
            Field::new("file_type", DataType::Utf8, false),
            Field::new("inode", DataType::UInt64, false),
            Field::new("permissions", DataType::UInt32, false),
            Field::new("parent_path", DataType::Utf8, false),
            Field::new("depth", DataType::UInt32, false),
            Field::new("top_level_dir", DataType::Utf8, false),
        ]))
    }

    /// Write a batch of FileEntry records
    pub fn write_batch(&mut self, entries: &[FileEntry]) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }

        let batch = self.entries_to_record_batch(entries)?;
        self.writer.write(&batch)
            .context("Failed to write record batch")?;

        self.rows_written += entries.len() as u64;

        Ok(())
    }

    /// Convert FileEntry records to Arrow RecordBatch
    fn entries_to_record_batch(&self, entries: &[FileEntry]) -> Result<RecordBatch> {
        let _len = entries.len();

        // Build arrays
        let paths: StringArray = entries.iter().map(|e| Some(e.path.as_str())).collect();
        let sizes: UInt64Array = entries.iter().map(|e| Some(e.size)).collect();
        let modified_times: Int64Array = entries.iter().map(|e| Some(e.modified_time)).collect();
        let accessed_times: Int64Array = entries.iter().map(|e| Some(e.accessed_time)).collect();
        let created_times: Int64Array = entries.iter().map(|e| e.created_time).collect();
        let file_types: StringArray = entries.iter().map(|e| Some(e.file_type.as_str())).collect();
        let inodes: UInt64Array = entries.iter().map(|e| Some(e.inode)).collect();
        let permissions: UInt32Array = entries.iter().map(|e| Some(e.permissions)).collect();
        let parent_paths: StringArray = entries.iter().map(|e| Some(e.parent_path.as_str())).collect();
        let depths: UInt32Array = entries.iter().map(|e| Some(e.depth)).collect();
        let top_level_dirs: StringArray = entries.iter().map(|e| Some(e.top_level_dir.as_str())).collect();

        // Create arrays vector
        let arrays: Vec<ArrayRef> = vec![
            Arc::new(paths),
            Arc::new(sizes),
            Arc::new(modified_times),
            Arc::new(accessed_times),
            Arc::new(created_times),
            Arc::new(file_types),
            Arc::new(inodes),
            Arc::new(permissions),
            Arc::new(parent_paths),
            Arc::new(depths),
            Arc::new(top_level_dirs),
        ];

        RecordBatch::try_new(self.schema.clone(), arrays)
            .context("Failed to create record batch")
    }

    /// Consume batches from a channel and write them
    pub fn consume_batches(mut self, rx: Receiver<Vec<FileEntry>>) -> Result<u64> {
        let mut batches_processed = 0;

        for batch in rx {
            self.write_batch(&batch)?;
            batches_processed += 1;

            if batches_processed % 10 == 0 {
                info!("Written {} batches, {} rows total", batches_processed, self.rows_written);
            }
        }

        let total_rows = self.rows_written;
        self.close()?;

        Ok(total_rows)
    }

    /// Close the writer and finalize the file
    pub fn close(self) -> Result<()> {
        self.writer.close()
            .context("Failed to close Parquet writer")?;

        info!("Parquet file finalized: {} rows written", self.rows_written);
        Ok(())
    }

    pub fn rows_written(&self) -> u64 {
        self.rows_written
    }
}

/// Write entries to a Parquet file from a channel
pub fn write_to_parquet<P: AsRef<Path>>(
    output_path: P,
    rx: Receiver<Vec<FileEntry>>,
) -> Result<u64> {
    let writer = ParquetFileWriter::new(output_path)?;
    writer.consume_batches(rx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FileEntry;
    use crossbeam_channel::bounded;
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_entry(path: &str, size: u64) -> FileEntry {
        FileEntry {
            path: path.to_string(),
            size,
            modified_time: 1700000000,
            accessed_time: 1700000000,
            created_time: Some(1700000000),
            file_type: "txt".to_string(),
            inode: 12345,
            permissions: 0o644,
            parent_path: "/parent".to_string(),
            depth: 1,
            top_level_dir: "root".to_string(),
        }
    }

    #[test]
    fn test_write_single_batch() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test.parquet");

        let entries = vec![
            create_test_entry("/test/file1.txt", 1024),
            create_test_entry("/test/file2.txt", 2048),
        ];

        let mut writer = ParquetFileWriter::new(&output_path).unwrap();
        writer.write_batch(&entries).unwrap();
        writer.close().unwrap();

        // Verify file exists
        assert!(output_path.exists());

        // Read back and verify
        let file = File::open(&output_path).unwrap();
        let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
        let reader = builder.build().unwrap();

        let mut total_rows = 0;
        for batch_result in reader {
            let batch = batch_result.unwrap();
            total_rows += batch.num_rows();
        }

        assert_eq!(total_rows, 2);
    }

    #[test]
    fn test_write_multiple_batches() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test_multiple.parquet");

        let (tx, rx) = bounded(10);

        // Send multiple batches
        let handle = std::thread::spawn(move || {
            for i in 0..5 {
                let batch = vec![
                    create_test_entry(&format!("/test/file{}.txt", i * 2), 1024),
                    create_test_entry(&format!("/test/file{}.txt", i * 2 + 1), 2048),
                ];
                tx.send(batch).unwrap();
            }
        });

        let rows_written = write_to_parquet(&output_path, rx).unwrap();
        handle.join().unwrap();

        assert_eq!(rows_written, 10);

        // Verify file
        let file = File::open(&output_path).unwrap();
        let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
        let reader = builder.build().unwrap();

        let mut total_rows = 0;
        for batch_result in reader {
            let batch = batch_result.unwrap();
            total_rows += batch.num_rows();
        }

        assert_eq!(total_rows, 10);
    }

    #[test]
    fn test_empty_batch() {
        let temp_dir = TempDir::new().unwrap();
        let output_path = temp_dir.path().join("test_empty.parquet");

        let mut writer = ParquetFileWriter::new(&output_path).unwrap();
        writer.write_batch(&[]).unwrap();
        assert_eq!(writer.rows_written(), 0);
    }

    #[test]
    fn test_schema_creation() {
        let schema = ParquetFileWriter::create_schema();

        // Verify all expected fields exist
        assert_eq!(schema.fields().len(), 11);
        assert!(schema.field_with_name("path").is_ok());
        assert!(schema.field_with_name("size").is_ok());
        assert!(schema.field_with_name("modified_time").is_ok());
        assert!(schema.field_with_name("file_type").is_ok());
    }
}
