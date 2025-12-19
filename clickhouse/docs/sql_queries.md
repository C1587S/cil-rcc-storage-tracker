# ClickHouse Direct SQL Query Guide (Filesystem Analytics)

This document is a **ClickHouse-native SQL guide** for exploring large-scale filesystem data
**directly from the ClickHouse CLI**, without Python.

It is intended for:
- Manual exploration
- Query debugging
- Performance validation
- Ad‑hoc analytics
- Dashboard query prototyping

All queries are **snapshot-aware**, **hierarchy-safe**, and **production-correct**.

---

## Table of Contents

- How to Access ClickHouse (Docker)
- Schema Assumptions
- Snapshot Overview Queries
- File-Level Queries
- Folder-Level (Hierarchical) Queries
- Depth & Hierarchy Queries
- File-Type Analytics
- User-Based Analytics
- Time & Activity Queries
- Data Quality Queries
- Performance Notes

---

## How to Access ClickHouse (Docker)

### 1. Start ClickHouse

From the ClickHouse project directory:

```bash
docker compose up -d
```

Verify it is running:

```bash
docker ps | grep clickhouse
```

---

### 2. Enter the ClickHouse Client

```bash
docker exec -it tracker-clickhouse clickhouse-client
```

If your container name is different:

```bash
docker ps
docker exec -it <container_name> clickhouse-client
```

---

### 3. Select Database

```sql
USE filesystem;
```

---

## Schema Assumptions (Critical)

### filesystem.entries

| Column | Type |
|------|------|
| snapshot_date | Date |
| path | String |
| parent_path | String |
| size | UInt64 (bytes) |
| is_directory | UInt8 |
| owner | String |
| file_type | String |
| created_time | UInt64 |
| modified_time | UInt64 |

> There are **NO directory rows**.  
> Folder analytics are **derived from files**.

---

## Snapshot Overview Queries

### List Available Snapshots

```sql
SELECT
    snapshot_date,
    formatReadableSize(total_size) AS total_size,
    total_files
FROM filesystem.snapshots
ORDER BY snapshot_date DESC;
```

---

### Use Latest Snapshot

```sql
SELECT max(snapshot_date) FROM filesystem.entries;
```

---

## File-Level Queries

### Top 1000 Largest Files

```sql
SELECT
    path,
    parent_path,
    formatReadableSize(size) AS size
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
ORDER BY size DESC
LIMIT 1000;
```

---

### Files Larger Than 10 GB

```sql
SELECT
    path,
    owner,
    formatReadableSize(size) AS size,
    toDateTime(modified_time) AS last_modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
  AND size > 10 * 1024 * 1024 * 1024
ORDER BY size DESC;
```

---

## Folder-Level Queries (Derived)

### Largest Folders (by Total Size)

```sql
SELECT
    parent_path AS folder,
    formatReadableSize(sum(size)) AS total_size,
    count() AS file_count,
    toDateTime(max(modified_time)) AS last_activity
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
GROUP BY parent_path
ORDER BY sum(size) DESC
LIMIT 10;
```

---

### Largest Folders at Same Depth

```sql
WITH folders AS (
    SELECT
        parent_path AS folder,
        length(splitByChar('/', trim(BOTH '/' FROM parent_path))) AS depth,
        sum(size) AS total_size,
        count() AS file_count
    FROM filesystem.entries
    WHERE snapshot_date = '2025-12-12'
      AND is_directory = 0
    GROUP BY parent_path
)
SELECT
    folder,
    depth,
    formatReadableSize(total_size) AS size,
    file_count
FROM folders
WHERE depth = 3
ORDER BY total_size DESC
LIMIT 10;
```

---

### Largest Non-Nested Folders

```sql
WITH folder_sizes AS (
    SELECT
        parent_path AS folder,
        sum(size) AS total_size
    FROM filesystem.entries
    WHERE snapshot_date = '2025-12-12'
      AND is_directory = 0
    GROUP BY parent_path
)
SELECT
    folder,
    formatReadableSize(total_size) AS size
FROM folder_sizes f
WHERE NOT EXISTS (
    SELECT 1
    FROM folder_sizes p
    WHERE f.folder != p.folder
      AND startsWith(f.folder, concat(p.folder, '/'))
)
ORDER BY total_size DESC
LIMIT 10;
```

---

## File-Type Analytics

### Storage by File Type

```sql
SELECT
    file_type,
    formatReadableSize(sum(size)) AS size,
    count() AS file_count
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
GROUP BY file_type
ORDER BY sum(size) DESC
LIMIT 10;
```

---

### File-Type Breakdown Within a Folder

```sql
SELECT
    file_type,
    formatReadableSize(sum(size)) AS size,
    count() AS file_count
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND parent_path = '/gpfs/projects/climate'
  AND is_directory = 0
GROUP BY file_type
ORDER BY sum(size) DESC;
```

---

## User-Based Analytics

### Largest File per User

```sql
SELECT
    owner,
    path,
    formatReadableSize(size) AS size,
    toDateTime(modified_time) AS last_activity
FROM (
    SELECT
        owner,
        path,
        size,
        modified_time,
        row_number() OVER (PARTITION BY owner ORDER BY size DESC) AS rn
    FROM filesystem.entries
    WHERE snapshot_date = '2025-12-12'
      AND is_directory = 0
)
WHERE rn = 1
ORDER BY size DESC;
```

---

## Time & Activity Queries

### Recently Modified Files

```sql
SELECT
    path,
    formatReadableSize(size) AS size,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
ORDER BY modified_time DESC
LIMIT 100;
```

---

### Activity per Day

```sql
SELECT
    toDate(toDateTime(modified_time)) AS day,
    count() AS files_modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
GROUP BY day
ORDER BY day;
```

---

## Data Quality Queries

### Directories with Most Empty Files

```sql
SELECT
    parent_path AS directory,
    count() AS empty_files
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
  AND size = 0
GROUP BY parent_path
ORDER BY empty_files DESC
LIMIT 10;
```

---

### Empty Files with Metadata

```sql
SELECT
    parent_path AS directory,
    path,
    owner,
    file_type,
    toDateTime(created_time) AS created,
    toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = '2025-12-12'
  AND is_directory = 0
  AND size = 0
ORDER BY modified_time DESC
LIMIT 50;
```

---

## Performance Notes

- Always filter by `snapshot_date`
- Avoid recursive joins
- Prefer grouping on `parent_path`
- Use numeric columns for filtering and ordering
- `formatReadableSize()` is for output only

---

End of document.