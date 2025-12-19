# ClickHouse Python Query Guide

Practical guide for connecting to ClickHouse from Python and running **analytical queries for large-scale hierarchical filesystem data**.

This guide is **Python-first**, parameterized, snapshot-aware, and designed for dashboards and exploration.

---

## Table of Contents

- Connection Setup
- Schema Assumptions
- Basic Query Patterns
- File-Level Analytics
- Folder-Level Analytics
- Hierarchy & Depth Queries
- User-Based Analytics
- Time & Activity Queries
- Data Quality Queries
- Working with Results
- Best Practices

---

## Schema Assumptions (Important)

This guide assumes the following **minimum schema**:

### filesystem.entries
- snapshot_date (Date)
- path (String)
- parent_path (String)
- size (UInt64) — bytes
- is_directory (UInt8)
- owner (String)
- file_type (String)
- created_time (UInt64) — unix timestamp
- modified_time (UInt64) — unix timestamp

Folders are **derived**, not stored as rows.

---

## Connection Setup

### Install Dependencies

```bash
pip install clickhouse-driver pandas polars
```

### Connect to ClickHouse

```python
from clickhouse_driver import Client

def get_client(host='localhost', port=9000, database='filesystem'):
    return Client(host=host, port=port, database=database)

client = get_client()
print(client.execute("SELECT version()")[0][0])
```

---

## Basic Query Patterns

### Snapshot Overview

```python
def list_snapshots(client):
    return client.execute("""
        SELECT
            snapshot_date,
            formatReadableSize(total_size) AS total_size,
            total_files
        FROM filesystem.snapshots
        ORDER BY snapshot_date DESC
    """)
```

---

### Parameterized File Query

```python
def top_large_files(client, snapshot_date, min_size_gb=10, limit=10):
    return client.execute(
        """
        SELECT
            path,
            owner,
            size,
            formatReadableSize(size) AS size_readable,
            toDateTime(modified_time) AS last_modified
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
          AND size > %(min_size)s
        ORDER BY size DESC
        LIMIT %(limit)s
        """,
        {
            'snapshot': snapshot_date,
            'min_size': min_size_gb * 1024**3,
            'limit': limit,
        }
    )
```

---

## File-Level Analytics

### Top N Largest Files

```python
def largest_files(client, snapshot_date, limit=1000):
    return client.execute(
        """
        SELECT
            path,
            parent_path,
            formatReadableSize(size) AS size
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
        ORDER BY size DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

### Files Larger Than X GB

```python
def files_larger_than(client, snapshot_date, min_size_gb):
    return client.execute(
        """
        SELECT
            path,
            owner,
            formatReadableSize(size) AS size
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
          AND size > %(min_size)s
        ORDER BY size DESC
        """,
        {'snapshot': snapshot_date, 'min_size': min_size_gb * 1024**3}
    )
```

---

## Folder-Level Analytics (Derived)

### Largest Folders

```python
def largest_folders(client, snapshot_date, limit=10):
    return client.execute(
        """
        SELECT
            parent_path AS folder,
            formatReadableSize(sum(size)) AS size,
            count() AS file_count,
            toDateTime(max(modified_time)) AS last_activity
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
        GROUP BY parent_path
        ORDER BY sum(size) DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

### Largest Folders at Specific Depth

```python
def largest_folders_by_depth(client, snapshot_date, depth, limit=10):
    return client.execute(
        """
        WITH folders AS (
            SELECT
                parent_path AS folder,
                length(splitByChar('/', trim(BOTH '/' FROM parent_path))) AS depth,
                sum(size) AS total_size,
                count() AS file_count,
                max(modified_time) AS last_activity
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot)s
              AND is_directory = 0
            GROUP BY parent_path
        )
        SELECT
            folder,
            depth,
            formatReadableSize(total_size) AS size,
            file_count,
            toDateTime(last_activity) AS last_activity
        FROM folders
        WHERE depth = %(depth)s
        ORDER BY total_size DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'depth': depth, 'limit': limit}
    )
```

---

### Non-Nested Largest Folders

```python
def largest_non_nested_folders(client, snapshot_date, limit=10):
    return client.execute(
        """
        WITH folder_sizes AS (
            SELECT
                parent_path AS folder,
                sum(size) AS total_size
            FROM filesystem.entries
            WHERE snapshot_date = %(snapshot)s
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
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

## File-Type Analytics

### Storage by File Type

```python
def storage_by_file_type(client, snapshot_date, limit=10):
    return client.execute(
        """
        SELECT
            file_type,
            formatReadableSize(sum(size)) AS size,
            count() AS file_count
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
        GROUP BY file_type
        ORDER BY sum(size) DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

### File-Type Breakdown per Folder

```python
def folder_file_type_breakdown(client, snapshot_date, folder, limit=10):
    return client.execute(
        """
        SELECT
            file_type,
            formatReadableSize(sum(size)) AS size,
            count() AS file_count
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND parent_path = %(folder)s
          AND is_directory = 0
        GROUP BY file_type
        ORDER BY sum(size) DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'folder': folder, 'limit': limit}
    )
```

---

## User-Based Analytics

### Largest Files per User

```python
def largest_files_per_user(client, snapshot_date, limit=1):
    return client.execute(
        """
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
            WHERE snapshot_date = %(snapshot)s
              AND is_directory = 0
        )
        WHERE rn <= %(limit)s
        ORDER BY size DESC
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

## Time & Activity Analytics

### Recently Modified Files

```python
def recently_modified_files(client, snapshot_date, limit=100):
    return client.execute(
        """
        SELECT
            path,
            formatReadableSize(size) AS size,
            toDateTime(modified_time) AS modified
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
        ORDER BY modified_time DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

### Activity Heatmap (per Day)

```python
def activity_by_day(client, snapshot_date):
    return client.execute(
        """
        SELECT
            toDate(toDateTime(modified_time)) AS day,
            count() AS files_modified
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
        GROUP BY day
        ORDER BY day
        """,
        {'snapshot': snapshot_date}
    )
```

---

## Data Quality Queries

### Directories with Empty Files

```python
def directories_with_empty_files(client, snapshot_date, limit=10):
    return client.execute(
        """
        SELECT
            parent_path AS directory,
            count() AS empty_files
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
          AND size = 0
        GROUP BY parent_path
        ORDER BY empty_files DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

### Empty Files with Metadata

```python
def empty_files_detailed(client, snapshot_date, limit=50):
    return client.execute(
        """
        SELECT
            parent_path AS directory,
            path,
            owner,
            file_type,
            toDateTime(created_time) AS created,
            toDateTime(modified_time) AS modified
        FROM filesystem.entries
        WHERE snapshot_date = %(snapshot)s
          AND is_directory = 0
          AND size = 0
        ORDER BY modified_time DESC
        LIMIT %(limit)s
        """,
        {'snapshot': snapshot_date, 'limit': limit}
    )
```

---

## Working with Results

### Streaming

```python
def stream_query(client, query, params=None, batch_size=50_000):
    for batch in client.execute_iter(
        query,
        params or {},
        settings={'max_block_size': batch_size}
    ):
        yield batch
```

---

### Export to CSV

```python
import pandas as pd

def export_to_csv(client, query, params, output_file):
    df = pd.DataFrame(client.execute(query, params))
    df.to_csv(output_file, index=False)
```

---

## Best Practices

1. Always parameterize `snapshot_date`.
2. Use numeric columns for filters and ordering.
3. Use `formatReadableSize()` only in SELECT.
4. Derive hierarchy from paths.
5. Stream large results.
6. Treat ClickHouse as a serving analytics engine.

---

