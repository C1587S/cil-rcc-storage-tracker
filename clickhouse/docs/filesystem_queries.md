# ClickHouse Filesystem Search Guide
## Fast File & Directory Search by Name

This document focuses on **one of the most valuable features** of the system:
**fast, interactive search of files and directories by name and patterns** using ClickHouse.

It answers questions like:
- Where is this exact file located?
- Does this filename appear in multiple places?
- Find files whose name contains a keyword (not exact match)
- Show owners, creation time, and modification time
- Detect duplicates by name
- Explore suspicious or common naming patterns

All queries are designed to:
- Run directly in `clickhouse-client`
- Be snapshot-aware
- Scale to hundreds of millions or billions of rows
- Return human-readable output

---

## Quick Start: Enter ClickHouse

### 1. Start the server

```bash
cd clickhouse
docker compose up -d
```

### 2. Enter the ClickHouse CLI

```bash
docker exec -it tracker-clickhouse clickhouse-client
```

If the container name is different:

```bash
docker ps
docker exec -it <container_name> clickhouse-client
```

### 3. Select the database

```sql
USE filesystem;
```

---

## Schema Assumptions (Search-Relevant)

Table: `filesystem.entries`

| Column | Description |
|------|-------------|
| snapshot_date | Snapshot date |
| path | Full absolute path |
| parent_path | Parent directory |
| name | File or directory name |
| size | File size in bytes |
| is_directory | 0=file, 1=directory |
| owner | File owner |
| created_time | Unix timestamp |
| modified_time | Unix timestamp |

> Searches are performed primarily on `name` and `path`.

---

## Exact Filename Search

### Find a file by exact name

Example:
> `log_inc_poly4_2025_IncPred.csv`

```sql
SELECT
    path,
    parent_path,
    formatReadableSize(size) AS size,
    owner,
    toDateTime(created_time) AS created,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND name = 'log_inc_poly4_2025_IncPred.csv'
ORDER BY modified_time DESC;
```

---

## Case-Insensitive Exact Search

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND lower(name) = lower('log_inc_poly4_2025_IncPred.csv');
```

---

## Partial Name Search (Substring)

### Find files containing a keyword

Example:
> files containing `"weights"` in the name

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND name LIKE '%weights%'
  AND is_directory = 0
ORDER BY size DESC
LIMIT 100;
```

---

### Case-insensitive substring search

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND positionCaseInsensitive(name, 'weights') > 0
LIMIT 100;
```

---

## Search by Extension

### Find all CSV files

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND name LIKE '%.csv'
ORDER BY size DESC
LIMIT 100;
```

---

### Large files of a given extension

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND name LIKE '%.csv'
  AND size > 1 * 1024 * 1024 * 1024
ORDER BY size DESC;
```

---

## Directory Name Search

### Find directories by name

```sql
SELECT
    path,
    owner,
    toDateTime(modified_time) AS last_activity
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 1
  AND name = 'outputs';
```

---

### Find directories by partial name

```sql
SELECT
    path,
    toDateTime(modified_time) AS last_activity
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 1
  AND name LIKE '%backup%';
```

---

## Duplicate Filename Detection

### Files with the same name in multiple locations

```sql
SELECT
    name,
    count() AS occurrences,
    groupArray(path) AS locations
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
GROUP BY name
HAVING occurrences > 1
ORDER BY occurrences DESC
LIMIT 100;
```

---

### Duplicate filenames with metadata

```sql
SELECT
    e.name,
    e.path,
    formatReadableSize(e.size) AS size,
    e.owner,
    toDateTime(e.modified_time) AS modified
FROM filesystem.entries e
INNER JOIN (
    SELECT name
    FROM filesystem.entries
    WHERE snapshot_date = '2025-12-12'
      AND is_directory = 0
    GROUP BY name
    HAVING count() > 1
) d ON e.name = d.name
WHERE e.snapshot_date = '2025-12-12'
ORDER BY e.name, e.modified_time DESC;
```

---

## Search Within a Directory Tree

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND path LIKE '/home/users/alice/%'
  AND name LIKE '%weights%'
ORDER BY size DESC
LIMIT 100;
```

---

## Recently Modified Matching Files

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    owner,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND name LIKE '%weights%'
  AND modified_time > toUnixTimestamp(now() - INTERVAL 30 DAY)
ORDER BY modified_time DESC
LIMIT 100;
```

---

## Ownership-Based Search

```sql
SELECT
    owner,
    count() AS file_count,
    formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND name LIKE '%weights%'
  AND is_directory = 0
GROUP BY owner
ORDER BY sum(size) DESC;
```

---

## Search Performance Notes

- Always filter by `snapshot_date`
- Prefer `name` over `path` when possible
- Use `LIMIT` for interactive searches
- Bloom filter indexes on `name` and `path` are strongly recommended

### Recommended Indexes

```sql
ALTER TABLE filesystem.entries
ADD INDEX idx_name_bloom name TYPE bloom_filter GRANULARITY 4;

ALTER TABLE filesystem.entries
ADD INDEX idx_path_bloom path TYPE bloom_filter GRANULARITY 4;
```

---

## Summary

ClickHouse enables filesystem search at **interactive speeds**:
- Exact name lookup
- Partial and fuzzy matching
- Duplicate detection
- Ownership and activity visibility

This is one of the **highest-impact features** for dashboards and user support workflows.

---

