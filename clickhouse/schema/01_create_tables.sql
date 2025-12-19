-- =====================================================
-- ClickHouse Schema for Filesystem Analytics
-- =====================================================
--
-- This schema is optimized for:
-- - Hierarchical navigation (parent-child queries)
-- - Fast search (path-based lookups)
-- - Analytical aggregations (size, counts, distributions)
-- - Time-series analysis (snapshot comparisons)
--
-- Design principles:
-- - Columnar storage for analytics
-- - Proper ORDER BY for query patterns
-- - Bloom filters for search
-- - Partitioning for snapshot isolation
-- =====================================================

-- Create database (idempotent - safe after nuke)
CREATE DATABASE IF NOT EXISTS filesystem;

-- =====================================================
-- Main Table: filesystem.entries
-- =====================================================
-- Stores all filesystem entries across all snapshots
--
-- Query patterns optimized:
-- 1. Get children: WHERE parent_path = X ORDER BY size
-- 2. Search by path: WHERE path LIKE X
-- 3. Filter by snapshot: WHERE snapshot_date = X
-- 4. Aggregate by directory: GROUP BY parent_path
-- =====================================================

CREATE TABLE IF NOT EXISTS filesystem.entries
(
    -- Snapshot identification
    snapshot_date Date,

    -- Path hierarchy (critical for navigation)
    path String,
    parent_path String,
    name String,  -- Extracted filename/dirname
    depth UInt16,  -- Distance from scan root
    top_level_dir String,  -- Top-level directory category

    -- File metadata
    size UInt64,
    file_type String,  -- Extension or 'directory'
    is_directory UInt8,  -- Boolean: 1=dir, 0=file

    -- Timestamps (as Unix epoch seconds)
    modified_time UInt32,
    accessed_time UInt32,
    created_time UInt32,

    -- Unix filesystem metadata
    inode UInt64,
    permissions UInt16,
    owner String,
    group_name String,
    uid UInt32,
    gid UInt32,

    -- Import tracking
    import_time DateTime DEFAULT now(),

    -- =====================================================
    -- Indexes for Fast Lookups
    -- =====================================================

    -- Index on path for fast LIKE searches
    INDEX idx_path path TYPE bloom_filter(0.01) GRANULARITY 1,

    -- Index on parent_path for fast children lookups
    INDEX idx_parent parent_path TYPE bloom_filter(0.01) GRANULARITY 1,

    -- Index on file_type for fast type filtering
    INDEX idx_file_type file_type TYPE set(100) GRANULARITY 4,

    -- Index on owner for fast ownership queries
    INDEX idx_owner owner TYPE set(0) GRANULARITY 4,

    -- Index on top_level_dir for partition pruning
    INDEX idx_top_level top_level_dir TYPE set(50) GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(snapshot_date)
PRIMARY KEY (snapshot_date, parent_path, path)
ORDER BY (snapshot_date, parent_path, path)
SETTINGS
    index_granularity = 8192,
    min_bytes_for_wide_part = 0;  -- Always use wide format for better compression

-- =====================================================
-- Comments (for documentation)
-- =====================================================

ALTER TABLE filesystem.entries
    COMMENT COLUMN snapshot_date 'Date of filesystem snapshot (YYYY-MM-DD)',
    COMMENT COLUMN path 'Absolute path to file or directory',
    COMMENT COLUMN parent_path 'Parent directory path',
    COMMENT COLUMN name 'Filename or directory name (last component of path)',
    COMMENT COLUMN depth 'Directory depth from scan root',
    COMMENT COLUMN top_level_dir 'Top-level category (e.g., home_dirs, gcp, shares)',
    COMMENT COLUMN size 'File size in bytes (0 for directories)',
    COMMENT COLUMN file_type 'File extension or "directory"',
    COMMENT COLUMN is_directory 'Boolean flag: 1=directory, 0=file',
    COMMENT COLUMN modified_time 'Last modified time (Unix timestamp)',
    COMMENT COLUMN accessed_time 'Last accessed time (Unix timestamp)',
    COMMENT COLUMN created_time 'Creation time (Unix timestamp)',
    COMMENT COLUMN inode 'Unix inode number',
    COMMENT COLUMN permissions 'Unix permission bits (octal)',
    COMMENT COLUMN owner 'File owner username',
    COMMENT COLUMN group_name 'File group name',
    COMMENT COLUMN uid 'User ID',
    COMMENT COLUMN gid 'Group ID',
    COMMENT COLUMN import_time 'Timestamp when data was imported to ClickHouse';

-- =====================================================
-- Table: filesystem.snapshots
-- =====================================================
-- Metadata about each snapshot
-- Used for snapshot listing and selection
-- =====================================================

CREATE TABLE IF NOT EXISTS filesystem.snapshots
(
    snapshot_date Date,
    scan_started DateTime,
    scan_completed DateTime,
    total_entries UInt64,
    total_size UInt64,
    total_directories UInt64,
    total_files UInt64,
    top_level_dirs Array(String),
    scanner_version String,
    import_time DateTime DEFAULT now(),
    import_duration_seconds Float32
)
ENGINE = MergeTree()
ORDER BY snapshot_date
SETTINGS index_granularity = 1;

ALTER TABLE filesystem.snapshots
    COMMENT COLUMN snapshot_date 'Date of filesystem snapshot',
    COMMENT COLUMN scan_started 'When filesystem scan started',
    COMMENT COLUMN scan_completed 'When filesystem scan completed',
    COMMENT COLUMN total_entries 'Total number of files + directories',
    COMMENT COLUMN total_size 'Total size in bytes',
    COMMENT COLUMN total_directories 'Number of directories',
    COMMENT COLUMN total_files 'Number of files',
    COMMENT COLUMN top_level_dirs 'List of top-level directory names',
    COMMENT COLUMN scanner_version 'Version of scanner that created snapshot',
    COMMENT COLUMN import_time 'When snapshot was imported to ClickHouse',
    COMMENT COLUMN import_duration_seconds 'How long import took';

-- =====================================================
-- Table: filesystem.search_index (Optional)
-- =====================================================
-- Dedicated table for full-text search
-- Populated from entries table
-- Uses ngram index for fuzzy matching
-- =====================================================

CREATE TABLE IF NOT EXISTS filesystem.search_index
(
    snapshot_date Date,
    path String,
    name String,
    name_lower String,  -- Lowercase for case-insensitive search
    size UInt64,
    is_directory UInt8,
    parent_path String,

    -- Ngram bloom filter for fuzzy name matching
    INDEX idx_name_ngram name_lower TYPE ngrambf_v1(3, 65536, 2, 0) GRANULARITY 1
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, name_lower, path)
SETTINGS index_granularity = 8192;

-- =====================================================
-- Verify Schema
-- =====================================================

-- Show created tables
SELECT
    name,
    engine,
    total_rows,
    total_bytes
FROM system.tables
WHERE database = 'filesystem'
ORDER BY name;
