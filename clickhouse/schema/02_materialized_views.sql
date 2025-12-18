-- =====================================================
-- Materialized Views for Pre-Aggregation
-- =====================================================
--
-- These views automatically maintain aggregated data
-- that updates on every INSERT to the source table.
--
-- Benefits:
-- - Instant query results for common aggregations
-- - No manual refresh needed
-- - Incremental updates only
--
-- Trade-offs:
-- - Additional storage (typically 20-40% overhead)
-- - Slightly slower INSERTs (negligible for batch)
-- =====================================================

-- Ensure database exists (idempotent)
CREATE DATABASE IF NOT EXISTS filesystem;

-- =====================================================
-- View: directory_sizes
-- =====================================================
-- Pre-computed directory sizes
--
-- Query pattern:
--   SELECT total_size FROM directory_sizes
--   WHERE snapshot_date = X AND path = Y
--
-- Performance: O(1) vs O(n) full scan
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.directory_sizes
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, path)
POPULATE
AS SELECT
    snapshot_date,
    parent_path AS path,
    sum(size) AS total_size,
    count() AS entry_count,
    sumIf(1, is_directory = 1) AS dir_count,
    sumIf(1, is_directory = 0) AS file_count
FROM filesystem.entries
GROUP BY snapshot_date, parent_path;

-- =====================================================
-- View: directory_hierarchy
-- =====================================================
-- Pre-computed parent-child relationships
--
-- Critical for O(1) navigation: "get children of directory X"
--
-- Query pattern:
--   SELECT child_path, total_size, is_directory
--   FROM directory_hierarchy
--   WHERE snapshot_date = X AND parent_path = Y
--   ORDER BY total_size DESC
--
-- This is THE MOST IMPORTANT view for dashboard performance
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.directory_hierarchy
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, parent_path, name)
POPULATE
AS SELECT
    snapshot_date,
    parent_path,
    name,
    path AS child_path,
    is_directory,
    size AS total_size,
    1 AS file_count,
    modified_time AS last_modified
FROM filesystem.entries;

-- =====================================================
-- View: file_type_distribution
-- =====================================================
-- Pre-computed file type statistics
--
-- Query pattern:
--   SELECT file_type, total_size, file_count
--   FROM file_type_distribution
--   WHERE snapshot_date = X
--   ORDER BY total_size DESC
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.file_type_distribution
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, file_type)
POPULATE
AS SELECT
    snapshot_date,
    file_type,
    count() AS file_count,
    sum(size) AS total_size,
    avg(size) AS avg_size,
    max(size) AS max_size
FROM filesystem.entries
WHERE is_directory = 0  -- Only files, not directories
GROUP BY snapshot_date, file_type;

-- =====================================================
-- View: owner_distribution
-- =====================================================
-- Pre-computed ownership statistics
--
-- Query pattern:
--   SELECT owner, total_size, file_count
--   FROM owner_distribution
--   WHERE snapshot_date = X
--   ORDER BY total_size DESC
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.owner_distribution
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, owner)
POPULATE
AS SELECT
    snapshot_date,
    owner,
    count() AS file_count,
    sum(size) AS total_size,
    sumIf(1, is_directory = 1) AS dir_count,
    sumIf(1, is_directory = 0) AS file_only_count
FROM filesystem.entries
GROUP BY snapshot_date, owner;

-- =====================================================
-- View: top_level_summary
-- =====================================================
-- Pre-computed statistics by top-level directory
--
-- Query pattern:
--   SELECT top_level_dir, total_size, file_count
--   FROM top_level_summary
--   WHERE snapshot_date = X
--   ORDER BY total_size DESC
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.top_level_summary
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, top_level_dir)
POPULATE
AS SELECT
    snapshot_date,
    top_level_dir,
    count() AS entry_count,
    sum(size) AS total_size,
    sumIf(1, is_directory = 1) AS dir_count,
    sumIf(1, is_directory = 0) AS file_count,
    max(modified_time) AS last_modified
FROM filesystem.entries
GROUP BY snapshot_date, top_level_dir;

-- =====================================================
-- View: heavy_files
-- =====================================================
-- Pre-computed list of largest files
--
-- Maintains top 10,000 largest files per snapshot
-- Much faster than scanning full table
--
-- Query pattern:
--   SELECT path, size, owner, modified_time
--   FROM heavy_files
--   WHERE snapshot_date = X
--   ORDER BY size DESC
--   LIMIT 100
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.heavy_files
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, size, path)
POPULATE
AS
SELECT
    snapshot_date,
    path,
    size,
    file_type,
    owner,
    modified_time,
    parent_path
FROM (
    SELECT
        snapshot_date,
        path,
        size,
        file_type,
        owner,
        modified_time,
        parent_path,
        row_number() OVER (PARTITION BY snapshot_date ORDER BY size DESC) AS rn
    FROM filesystem.entries
    WHERE is_directory = 0  -- Only files
)
WHERE rn <= 10000;  -- Keep top 10k per snapshot

-- =====================================================
-- View: depth_distribution
-- =====================================================
-- Pre-computed statistics by directory depth
--
-- Useful for understanding hierarchy structure
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.depth_distribution
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, depth)
POPULATE
AS SELECT
    snapshot_date,
    depth,
    count() AS entry_count,
    sum(size) AS total_size,
    sumIf(1, is_directory = 1) AS dir_count,
    sumIf(1, is_directory = 0) AS file_count
FROM filesystem.entries
GROUP BY snapshot_date, depth;

-- =====================================================
-- View: size_buckets
-- =====================================================
-- Pre-computed distribution by file size ranges
--
-- Query pattern for charts: "Distribution of files by size"
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.size_buckets
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, bucket)
POPULATE
AS SELECT
    snapshot_date,
    CASE
        WHEN size = 0 THEN 'Empty'
        WHEN size < 1024 THEN '< 1 KB'
        WHEN size < 1024 * 1024 THEN '1 KB - 1 MB'
        WHEN size < 10 * 1024 * 1024 THEN '1 MB - 10 MB'
        WHEN size < 100 * 1024 * 1024 THEN '10 MB - 100 MB'
        WHEN size < 1024 * 1024 * 1024 THEN '100 MB - 1 GB'
        ELSE '> 1 GB'
    END AS bucket,
    count() AS file_count,
    sum(size) AS total_size
FROM filesystem.entries
WHERE is_directory = 0
GROUP BY snapshot_date, bucket;

-- =====================================================
-- View: age_distribution
-- =====================================================
-- Pre-computed distribution by file age (last modified)
--
-- Query pattern: "Show files not modified in X days"
-- =====================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS filesystem.age_distribution
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (snapshot_date, age_bucket)
POPULATE
AS SELECT
    snapshot_date,
    CASE
        WHEN modified_time >= toUnixTimestamp(now() - INTERVAL 7 DAY) THEN '< 7 days'
        WHEN modified_time >= toUnixTimestamp(now() - INTERVAL 30 DAY) THEN '7-30 days'
        WHEN modified_time >= toUnixTimestamp(now() - INTERVAL 90 DAY) THEN '30-90 days'
        WHEN modified_time >= toUnixTimestamp(now() - INTERVAL 180 DAY) THEN '90-180 days'
        WHEN modified_time >= toUnixTimestamp(now() - INTERVAL 365 DAY) THEN '180-365 days'
        ELSE '> 1 year'
    END AS age_bucket,
    count() AS file_count,
    sum(size) AS total_size
FROM filesystem.entries
WHERE is_directory = 0
GROUP BY snapshot_date, age_bucket;

-- =====================================================
-- Verify Materialized Views
-- =====================================================

SELECT
    name,
    engine,
    total_rows,
    formatReadableSize(total_bytes) AS size
FROM system.tables
WHERE database = 'filesystem'
  AND engine LIKE '%MergeTree%'
ORDER BY name;

-- =====================================================
-- Query Examples Using Materialized Views
-- =====================================================

-- Example 1: Get children of directory (O(1) lookup)
-- SELECT
--     child_path,
--     name,
--     is_directory,
--     total_size,
--     last_modified
-- FROM filesystem.directory_hierarchy
-- WHERE snapshot_date = '2025-12-12'
--   AND parent_path = '/home/users'
-- ORDER BY total_size DESC
-- LIMIT 1000;

-- Example 2: Get directory size (instant)
-- SELECT
--     path,
--     total_size,
--     entry_count,
--     file_count,
--     dir_count
-- FROM filesystem.directory_sizes
-- WHERE snapshot_date = '2025-12-12'
--   AND path = '/home/users/alice';

-- Example 3: Top file types by size
-- SELECT
--     file_type,
--     file_count,
--     formatReadableSize(total_size) AS size
-- FROM filesystem.file_type_distribution
-- WHERE snapshot_date = '2025-12-12'
-- ORDER BY total_size DESC
-- LIMIT 20;

-- Example 4: Top owners by space usage
-- SELECT
--     owner,
--     file_count,
--     formatReadableSize(total_size) AS size
-- FROM filesystem.owner_distribution
-- WHERE snapshot_date = '2025-12-12'
-- ORDER BY total_size DESC
-- LIMIT 20;
