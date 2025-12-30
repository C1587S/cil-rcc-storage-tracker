-- Migration: Create voronoi_precomputed table for incremental loading
--
-- This table stores precomputed voronoi hierarchy nodes with their immediate children,
-- enabling incremental browser loading instead of massive JSON artifacts.
--
-- Design:
-- - Each row represents one node in the hierarchy
-- - children_json contains immediate children only (not deep recursion)
-- - Optimized for fast lookups by (snapshot_date, node_id)
-- - Supports streaming batch inserts during computation

CREATE TABLE IF NOT EXISTS filesystem.voronoi_precomputed (
    -- Primary keys
    snapshot_date Date,
    node_id String,

    -- Hierarchy metadata
    parent_id String,
    path String,
    name String,

    -- Size and counts
    size UInt64,
    depth UInt32,
    is_directory UInt8,
    file_count Nullable(UInt32),

    -- Serialized data (immediate children only)
    children_json String,  -- JSON array of immediate child nodes

    -- Additional metadata
    is_synthetic UInt8 DEFAULT 0,  -- 1 for __files__ nodes
    original_files_json String DEFAULT '',  -- For synthetic nodes

    -- Audit
    created_at DateTime DEFAULT now()

) ENGINE = MergeTree()
ORDER BY (snapshot_date, node_id)
SETTINGS index_granularity = 8192;

-- Create index for path lookups (useful for debugging)
-- Already covered by primary key, but explicit for clarity
-- ALTER TABLE filesystem.voronoi_precomputed ADD INDEX idx_path path TYPE minmax GRANULARITY 4;

-- Comment documenting the table purpose
-- COMMENT 'Precomputed voronoi hierarchy for incremental browser loading';
