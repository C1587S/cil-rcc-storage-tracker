#!/usr/bin/env python3
"""
Voronoi Computation & Storage - UNIFIED SCRIPT
----------------------------------------------
python compute_voronoi_unified.py 2025-12-27 --workers 8 --force

Architecture:
1. Streaming Stack-Based Computation (Low RAM)
2. Batch Insert to ClickHouse (Safe JSON Truncation)
3. Parallel Processing (Prevent Timeouts)
"""

import argparse
import json
import logging
import sys
import time
import multiprocessing
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import date
from typing import Any, Dict, List, Optional

# pip install clickhouse-driver tqdm
from clickhouse_driver import Client

# Try to import tqdm for progress bars
try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False
    def tqdm(iterable, **kwargs):
        return iterable

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("VoronoiUnified")

# ==============================================================================
# PART 1: STORAGE CLASS (Safe Inserts)
# ==============================================================================

class VoronoiStorage:
    """
    Streaming storage for voronoi hierarchy nodes in ClickHouse.
    Batches writes to avoid network overhead.
    """
    TABLE_NAME = "filesystem.voronoi_precomputed"
    
    # SAFETY: Max files to store in JSON to prevent 4GB RAM crashes.
    # 500 files is plenty for visualization.
    MAX_FILES_IN_JSON = 500 

    def __init__(self, db_config: Dict[str, Any], batch_size: int = 1000):
        self.db_config = db_config
        self.batch_size = batch_size  # Reduced default batch size for safety
        self.pending_rows: List[tuple] = []
        self.total_inserted = 0

    def _get_client(self) -> Client:
        return Client(**self.db_config)

    def ensure_table_exists(self) -> None:
        """Creates the destination table if it doesn't exist."""
        create_table_sql = f"""
        CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
            snapshot_date Date,
            node_id String,
            parent_id String,
            path String,
            name String,
            size UInt64,
            depth UInt32,
            is_directory UInt8,
            file_count Nullable(UInt32),
            children_json String,
            is_synthetic UInt8 DEFAULT 0,
            original_files_json String DEFAULT '',
            created_at DateTime DEFAULT now()
        ) ENGINE = MergeTree()
        ORDER BY (snapshot_date, node_id)
        SETTINGS index_granularity = 8192
        """
        try:
            client = self._get_client()
            client.execute(create_table_sql)
            client.disconnect()
        except Exception as e:
            logger.error(f"Failed to create table {self.TABLE_NAME}: {e}")
            raise

    def add_node(
        self,
        snapshot_date: date,
        node_id: str,
        parent_id: str,
        path: str,
        name: str,
        size: int,
        depth: int,
        is_directory: bool,
        file_count: Optional[int],
        children_ids: List[str],
        is_synthetic: bool = False,
        original_files: List[Dict[str, Any]] = None,
    ) -> None:
        """Adds a node to the buffer and flushes if full."""
        
        # Serialize Lists to JSON Strings
        children_json = json.dumps(children_ids) if children_ids else "[]"
        original_files_json = ""
        
        # KEY FIX: TRUNCATE FILE LIST TO PREVENT MEMORY CRASH
        if original_files:
            # Sort by size descending (keep the biggest ones for visualization)
            sorted_files = sorted(original_files, key=lambda x: x['size'], reverse=True)
            
            # Keep only top N
            if len(sorted_files) > self.MAX_FILES_IN_JSON:
                kept_files = sorted_files[:self.MAX_FILES_IN_JSON]
                # Add a dummy entry indicating truncation (optional, useful for UI)
                remaining_count = len(sorted_files) - self.MAX_FILES_IN_JSON
                remaining_size = sum(f['size'] for f in sorted_files[self.MAX_FILES_IN_JSON:])
                kept_files.append({
                    "name": f"... and {remaining_count} smaller files",
                    "path": "",
                    "size": remaining_size
                })
                original_files_json = json.dumps(kept_files)
            else:
                original_files_json = json.dumps(sorted_files)

        row = (
            snapshot_date, node_id, parent_id, path, name,
            size, depth, 1 if is_directory else 0, file_count,
            children_json, 1 if is_synthetic else 0, original_files_json,
        )

        self.pending_rows.append(row)

        if len(self.pending_rows) >= self.batch_size:
            self.flush()

    def flush(self) -> int:
        """Force write buffer to DB."""
        if not self.pending_rows:
            return 0
        try:
            client = self._get_client()
            client.execute(
                f"""
                INSERT INTO {self.TABLE_NAME} (
                    snapshot_date, node_id, parent_id, path, name,
                    size, depth, is_directory, file_count, children_json,
                    is_synthetic, original_files_json
                ) VALUES
                """,
                self.pending_rows,
            )
            count = len(self.pending_rows)
            self.total_inserted += count
            self.pending_rows.clear()
            client.disconnect()
            return count
        except Exception as e:
            logger.error(f"Failed to flush voronoi nodes: {e}")
            # If a massive batch fails, we might want to log it but re-raising is safer
            raise

    def delete_snapshot(self, snapshot_date: date) -> None:
        """Cleans up old data for idempotency."""
        query = f"ALTER TABLE {self.TABLE_NAME} DELETE WHERE snapshot_date = %(d)s"
        try:
            client = self._get_client()
            client.execute(query, {"d": snapshot_date.isoformat()})
            logger.info(f"Deleted old data for snapshot {snapshot_date}")
            client.disconnect()
        except Exception as e:
            logger.error(f"Failed to delete snapshot: {e}")

# ==============================================================================
# PART 2: COMPUTER CLASS (Optimized & Stable)
# ==============================================================================

class VoronoiComputer:
    """
    Reads from filesystem.entries (Streaming) -> Writes to VoronoiStorage
    OPTIMIZED: Performs Lookup in Python to avoid ClickHouse HashJoin OOM.
    STABLE: Uses external sorting settings to avoid OOM during global sort.
    """
    def __init__(self, snapshot_date: date, root_path: str, db_config: Dict[str, Any]):
        self.snapshot_date = snapshot_date
        self.root_path = root_path
        self.db_config = db_config
        self.node_counter = 0
        self.storage = VoronoiStorage(db_config)
        self.dir_stats = {} # Lookup cache

    def _generate_id(self, path: str, is_dir: bool) -> str:
        self.node_counter += 1
        prefix = "d" if is_dir else "f"
        h = abs(hash(path)) % 10000000
        return f"{prefix}_{h}_{self.node_counter}"

    def _calculate_depth(self, path: str) -> int:
        if path == self.root_path:
            return 0
        relative_path = path[len(self.root_path):].lstrip('/')
        if not relative_path:
            return 0
        return relative_path.count('/') + 1

    def _ensure_source_dependencies(self, client: Client):
        """Ensures the recursive size table exists."""
        sql = """
        CREATE TABLE IF NOT EXISTS filesystem.directory_recursive_sizes (
            snapshot_date Date,
            path String,
            depth UInt16,
            top_level_dir String,
            recursive_size_bytes UInt64,
            recursive_file_count UInt64,
            recursive_dir_count UInt64,
            direct_size_bytes UInt64,
            direct_file_count UInt64,
            last_modified UInt32,
            last_accessed UInt32
        ) ENGINE = MergeTree()
        PARTITION BY toYYYYMM(snapshot_date)
        ORDER BY (snapshot_date, path)
        """
        try:
            client.execute(sql)
        except Exception as e:
            logger.warning(f"Could not verify source table schema: {e}")

    def _load_directory_stats(self) -> None:
        """
        Pre-fetches recursive sizes only for the relevant tree.
        """
        client = Client(**self.db_config)
        self._ensure_source_dependencies(client)
        
        query = """
        SELECT path, recursive_size_bytes, recursive_file_count
        FROM filesystem.directory_recursive_sizes
        WHERE snapshot_date = %(date)s
          AND path LIKE %(root)s
        """
        try:
            results = client.execute(
                query, 
                {"date": self.snapshot_date.isoformat(), "root": self.root_path + "%"}
            )
            if not results and self.root_path == "/project/cil":
                logger.warning("Warning: No recursive stats found! Directories might show 0 size.")
            
            self.dir_stats = {row[0]: (row[1], row[2]) for row in results}
            
        except Exception as e:
            logger.error(f"Failed to load directory stats: {e}")
            raise
        finally:
            client.disconnect()

    def compute(self) -> Dict[str, Any]:
        self.storage.ensure_table_exists()
        
        # 1. Load Directory Stats into Python Memory
        self._load_directory_stats()
        
        # Get root stats
        root_stats = self.dir_stats.get(self.root_path, (0, 0))
        root_recursive_size = root_stats[0] or 0
        root_recursive_count = root_stats[1] or 0

        client = Client(**self.db_config)
        
        # 2. Optimized Stream Query (With External Sort)
        # We allow spilling to disk if sort takes > 1GB RAM
        query = """
        SELECT
            path,
            name,
            size,
            is_directory
        FROM filesystem.entries
        WHERE snapshot_date = %(date)s
          AND path LIKE %(root)s
        ORDER BY path ASC
        """
        
        # KEY SETTING: External Sort
        settings = {
            'max_bytes_before_external_sort': 1073741824, # 1 GB
            'max_block_size': 8192
        }

        stream = client.execute_iter(
            query, 
            {"date": self.snapshot_date.isoformat(), "root": self.root_path + "%"},
            settings=settings
        )

        # Initialize Stack
        root_id = self._generate_id(self.root_path, True)
        root_node = {
            "id": root_id,
            "name": self.root_path.split("/")[-1] or "root",
            "path": self.root_path,
            "size": 0,
            "is_directory": True,
            "depth": 0,  
            "file_count": 0,
            "children_ids": [],
            "files": [],
            "parent_id": "", 
        }
        
        stack = [(self.root_path, root_node)]
        nodes_processed = 0

        for row in stream:
            path, name, size, is_directory = row
            nodes_processed += 1

            # 1. Stack Management
            while stack and not path.startswith(stack[-1][0] + "/"):
                _, finished_node = stack.pop()
                self._finalize_and_insert(finished_node)

            if not stack: continue 

            parent_path, parent_node = stack[-1]

            # If row IS the root, update info
            if path == self.root_path:
                parent_node['size'] = root_recursive_size 
                parent_node['file_count'] = root_recursive_count
                continue

            # 2. Process New Item
            node_id = self._generate_id(path, is_directory)
            depth = self._calculate_depth(path)

            if is_directory:
                # LOOKUP
                d_stats = self.dir_stats.get(path, (0, 0))
                rec_size = d_stats[0] if d_stats[0] is not None else 0
                rec_count = d_stats[1] if d_stats[1] is not None else 0

                new_node = {
                    "id": node_id, 
                    "name": name, 
                    "path": path, 
                    "size": size, 
                    "is_directory": True, 
                    "depth": depth, 
                    "file_count": rec_count,
                    "children_ids": [], 
                    "files": [],
                    "parent_id": parent_node["id"]
                }
                parent_node["children_ids"].append(node_id)
                stack.append((path, new_node))
            else:
                parent_node["files"].append({
                    "name": name, "path": path, "size": size
                })

        client.disconnect()

        while stack:
            _, node = stack.pop()
            self._finalize_and_insert(node)

        self.storage.flush()
        self.dir_stats.clear() 
        
        return {
            "status": "success", 
            "path": self.root_path, 
            "processed": nodes_processed, 
            "inserted": self.storage.total_inserted
        }

    def _finalize_and_insert(self, node: dict):
        """Prepare node and send to storage class."""
        
        final_size = node['size']
        if node['is_directory']:
            if node['path'] in self.dir_stats:
                final_size = self.dir_stats[node['path']][0] or 0
        
        if node["files"]:
            files_id = node["id"] + "_files"
            files_size = sum(f["size"] for f in node["files"])
            
            self.storage.add_node(
                snapshot_date=self.snapshot_date,
                node_id=files_id,
                parent_id=node["id"],
                path=node["path"] + "/__files__",
                name="__files__",
                size=files_size,
                depth=node["depth"] + 1,
                is_directory=False,
                file_count=len(node["files"]),
                children_ids=[],
                is_synthetic=True,
                original_files=node["files"]
            )
            node["children_ids"].append(files_id)

        self.storage.add_node(
            snapshot_date=self.snapshot_date,
            node_id=node["id"],
            parent_id=node.get("parent_id", ""),
            path=node["path"],
            name=node["name"],
            size=final_size,
            depth=node["depth"],
            is_directory=node["is_directory"],
            file_count=node["file_count"],
            children_ids=node["children_ids"],
            is_synthetic=False,
            original_files=node["files"] if node["files"] else None
        )

# ==============================================================================
# PART 3: ORCHESTRATOR & HELPERS
# ==============================================================================

def worker_task(args):
    """Entry point for worker processes."""
    snapshot_date, root_path, db_config = args
    try:
        computer = VoronoiComputer(snapshot_date, root_path, db_config)
        return computer.compute()
    except Exception as e:
        return {"status": "error", "message": str(e), "path": root_path}

def fetch_subdirectories(snapshot_date, root_path, db_config) -> List[str]:
    """Finds top-level children to distribute workload."""
    client = Client(**db_config)
    try:
        # Check if table exists first to avoid crashes
        query = f"""
        SELECT child_path FROM filesystem.directory_hierarchy
        WHERE snapshot_date = '{snapshot_date.isoformat()}'
          AND parent_path = '{root_path}'
          AND is_directory = 1
        """
        result = client.execute(query)
        return [row[0] for row in result]
    except Exception as e:
        logger.warning(f"Could not fetch subdirectories (falling back to sequential): {e}")
        return []
    finally:
        client.disconnect()

def main():
    import os
    parser = argparse.ArgumentParser(description="Unified Voronoi Computer")
    parser.add_argument("snapshot_date", type=str, help="YYYY-MM-DD")
    parser.add_argument("--workers", type=int, default=1, help="Parallel workers")
    parser.add_argument("--force", action="store_true", help="Delete old data")
    parser.add_argument("--root", default="/project/cil", help="Root path")
    
    parser.add_argument("--host", default=os.getenv('CLICKHOUSE_HOST', 'localhost'))
    parser.add_argument("--port", type=int, default=int(os.getenv('CLICKHOUSE_PORT', '9000')))
    parser.add_argument("--user", default=os.getenv('CLICKHOUSE_USER', 'default'))
    parser.add_argument("--password", default=os.getenv('CLICKHOUSE_PASSWORD', ''))
    parser.add_argument("--database", default=os.getenv('CLICKHOUSE_DATABASE', 'filesystem'))

    args = parser.parse_args()

    db_config = {
        "host": args.host, "port": args.port, "user": args.user,
        "password": args.password, "database": args.database
    }

    try:
        snap_date = date.fromisoformat(args.snapshot_date)
    except ValueError:
        logger.error("Invalid date format. Use YYYY-MM-DD")
        sys.exit(1)

    logger.info(f"Target: {snap_date} | Root: {args.root} | Workers: {args.workers}")

    # 1. Cleanup Old Data
    if args.force:
        logger.info("Force flag: Cleaning old data...")
        tmp_storage = VoronoiStorage(db_config)
        tmp_storage.delete_snapshot(snap_date)

    start_time = time.time()

    # 2. Execution
    if args.workers > 1:
        logger.info("Mode: PARALLEL (Partitioning by Subtree)")
        subfolders = fetch_subdirectories(snap_date, args.root, db_config)
        
        if not subfolders:
            logger.warning("No subfolders found. Falling back to sequential.")
            tasks = [(snap_date, args.root, db_config)]
        else:
            logger.info(f"Distributing {len(subfolders)} sub-trees.")
            tasks = [(snap_date, folder, db_config) for folder in subfolders]
        
        total_inserted = 0
        
        # Parallel Execution
        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(worker_task, t) for t in tasks]
            pbar = tqdm(as_completed(futures), total=len(tasks), desc="Subtrees", disable=not HAS_TQDM)
            
            for future in pbar:
                res = future.result()
                if res["status"] == "error":
                    logger.error(f"Worker failed: {res['message']}")
                else:
                    total_inserted += res['inserted']
        
        logger.info(f"Parallel execution finished. Total rows: {total_inserted}")

    else:
        logger.info("Mode: SEQUENTIAL (Single Stream)")
        computer = VoronoiComputer(snap_date, args.root, db_config)
        res = computer.compute()
        logger.info(f"Processed: {res['processed']:,} | Inserted: {res['inserted']:,}")

    duration = time.time() - start_time
    logger.info(f"DONE. Duration: {duration:.2f}s")

if __name__ == "__main__":
    multiprocessing.set_start_method("spawn", force=True)
    main()