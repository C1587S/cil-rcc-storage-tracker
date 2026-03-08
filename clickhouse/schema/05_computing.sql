-- =====================================================
-- ClickHouse Schema for Computing Monitoring
-- =====================================================
-- Historical data for quota and SU usage tracking.
-- Live data (jobs, partitions) is served directly
-- from the RCC report JSON via API proxy.
-- =====================================================

CREATE DATABASE IF NOT EXISTS computing;

-- =====================================================
-- Table: computing.su_usage_daily
-- =====================================================
-- Daily SU consumption per user for trend analysis.
-- ReplacingMergeTree deduplicates same-day inserts.
-- =====================================================

CREATE TABLE IF NOT EXISTS computing.su_usage_daily
(
    date Date,
    user String,
    su_consumed Float64
)
ENGINE = ReplacingMergeTree()
ORDER BY (date, user);

-- =====================================================
-- Table: computing.su_summary_daily
-- =====================================================
-- Daily account-level SU totals for burn rate charts.
-- =====================================================

CREATE TABLE IF NOT EXISTS computing.su_summary_daily
(
    date Date,
    su_allocated Float64,
    su_consumed Float64,
    su_remaining Float64,
    su_burn_rate Float64
)
ENGINE = ReplacingMergeTree()
ORDER BY (date);

-- =====================================================
-- Table: computing.quota_daily
-- =====================================================
-- Daily disk quota snapshots per filesystem.
-- Tracks space and inode usage for trend charts.
-- =====================================================

CREATE TABLE IF NOT EXISTS computing.quota_daily
(
    date Date,
    cluster String,
    filesystem String,
    quota_type String,
    space_used_gb Float64,
    space_limit_gb Float64,
    space_pct Float64,
    files_used UInt64,
    files_limit UInt64,
    files_pct Float64
)
ENGINE = ReplacingMergeTree()
ORDER BY (date, cluster, filesystem, quota_type);
