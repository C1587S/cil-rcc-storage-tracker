#!/usr/bin/env python3
"""
Voronoi Computation & Storage - UNIFIED SCRIPT
----------------------------------------------
python compute_voronoi_unified.py 2025-12-12 --workers 10 --force
Architecture:
1. Streaming Stack-Based Computation (Low RAM)
2. Batch Insert to ClickHouse Table (filesystem.voronoi_precomputed)
3. Multiprocessing support for top-level directories.
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
# PART 1: STORAGE CLASS (Handles DB Inserts)
# ==============================================================================

class VoronoiStorage:
    """
    Streaming storage for voronoi hierarchy nodes in ClickHouse.
    Batches writes to avoid network overhead.
    """
    TABLE_NAME = "filesystem.voronoi_precomputed"

    def __init__(self, db_config: Dict[str, Any], batch_size: int = 5000):
        self.db_config = db_config
        self.batch_size = batch_size
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
            # logger.info(f"Ensured table {self.TABLE_NAME} exists")
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
        # Store original_files for BOTH synthetic nodes AND regular directories with files
        if original_files:
            original_files_json = json.dumps(original_files)

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
# PART 2: COMPUTER CLASS (Handles Streaming Logic)
# ==============================================================================

class VoronoiComputer:
    """
    Reads from filesystem.entries (Streaming) -> Writes to VoronoiStorage
    """
    def __init__(self, snapshot_date: date, root_path: str, db_config: Dict[str, Any]):
        self.snapshot_date = snapshot_date
        self.root_path = root_path
        self.db_config = db_config
        self.node_counter = 0
        # Initialize storage interface
        self.storage = VoronoiStorage(db_config)

    def _generate_id(self, path: str, is_dir: bool) -> str:
        self.node_counter += 1
        prefix = "d" if is_dir else "f"
        # Deterministic hash for parallel safety
        h = abs(hash(path)) % 10000000
        return f"{prefix}_{h}_{self.node_counter}"

    def _calculate_depth(self, path: str) -> int:
        """
        Calculate relative depth from root_path.
        Root path gets depth 0, immediate children get depth 1, etc.

        Examples:
          root_path = '/project/cil'
          '/project/cil' -> depth 0
          '/project/cil/gcp' -> depth 1
          '/project/cil/gcp/data' -> depth 2
        """
        if path == self.root_path:
            return 0

        # Remove root_path prefix and count remaining path segments
        relative_path = path[len(self.root_path):].lstrip('/')
        if not relative_path:
            return 0

        return relative_path.count('/') + 1

    def compute(self) -> Dict[str, Any]:
        self.storage.ensure_table_exists()
        client = Client(**self.db_config)

        # Get root file count BEFORE starting stream
        root_file_count_result = client.execute(
            """
            SELECT COALESCE(recursive_file_count, 0) as file_count
            FROM filesystem.directory_recursive_sizes
            WHERE snapshot_date = %(date)s AND path = %(path)s
            """,
            {"date": self.snapshot_date.isoformat(), "path": self.root_path}
        )
        root_file_count = root_file_count_result[0][0] if root_file_count_result else 0

        # Query with recursive file counts from directory_recursive_sizes
        query = """
        SELECT
            e.path,
            e.name,
            e.size,
            e.is_directory,
            CASE
                WHEN e.is_directory = 1 THEN COALESCE(r.recursive_file_count, 0)
                ELSE 0
            END AS recursive_file_count
        FROM filesystem.entries AS e
        LEFT JOIN filesystem.directory_recursive_sizes AS r
            ON e.snapshot_date = r.snapshot_date AND e.path = r.path
        WHERE e.snapshot_date = %(date)s
          AND e.path LIKE %(root)s
        ORDER BY e.path ASC
        """

        stream = client.execute_iter(
            query,
            {"date": self.snapshot_date.isoformat(), "root": self.root_path + "%"}
        )

        root_id = self._generate_id(self.root_path, True)
        root_node = {
            "id": root_id,
            "name": self.root_path.split("/")[-1] or "root",
            "path": self.root_path,
            "size": 0, # Se calculará sumando
            "is_directory": True,
            "depth": 0,  # Root always has depth 0
            "file_count": root_file_count,
            "children_ids": [],
            "files": [],
            "parent_id": "",  # Root has no parent
        }
        
        stack = [(self.root_path, root_node)]
        nodes_processed = 0

        for row in stream:
            path, name, size, is_directory, recursive_file_count = row
            nodes_processed += 1

            # 1. Stack Management: Cerrar nodos terminados y SUMAR tamaños
            while stack and not path.startswith(stack[-1][0] + "/"):
                _, finished_node = stack.pop()

                # BUBBLE UP SIZE: Sumar al padre
                if stack:
                    parent_path, parent_node = stack[-1]
                    parent_node['size'] += finished_node['size']

                self._finalize_and_insert(finished_node)

            if not stack: continue

            parent_path, parent_node = stack[-1]

            if path == self.root_path:
                # Update root with its recursive file count
                parent_node['file_count'] = recursive_file_count
                continue

            # 2. Process New Item
            node_id = self._generate_id(path, is_directory)
            depth = self._calculate_depth(path)  # Use relative depth

            if is_directory:
                new_node = {
                    "id": node_id, "name": name, "path": path,
                    "size": 0, # Inicia en 0, sumará hijos y archivos
                    "is_directory": True, "depth": depth, "file_count": recursive_file_count,
                    "children_ids": [], "files": [],
                    "parent_id": parent_node["id"]  # Track parent
                }
                parent_node["children_ids"].append(node_id)
                stack.append((path, new_node))
            else:
                # Archivo
                parent_node["files"].append({
                    "name": name, "path": path, "size": size
                })
                # Don't manually increment - using pre-calculated recursive_file_count
                parent_node["size"] += size # Sumar tamaño al directorio actual

        client.disconnect()

        # Finalize remaining stack
        while stack:
            _, finished_node = stack.pop()
            if stack:
                parent_path, parent_node = stack[-1]
                parent_node['size'] += finished_node['size']
                # Don't propagate file_count - using pre-calculated recursive values

            self._finalize_and_insert(finished_node)

        self.storage.flush()
        
        return {
            "status": "success", 
            "path": self.root_path, 
            "processed": nodes_processed, 
            "inserted": self.storage.total_inserted
        }     # Ensure table exists (safe to call multiple times)
        self.storage.ensure_table_exists()

        client = Client(**self.db_config)
        
        # Optimized Query: Streaming + Pre-calculated Sizes and File Counts
        # Uses `filesystem.directory_recursive_sizes` for accurate recursive metrics
        query = """
        SELECT
            e.path,
            e.name,
            CASE
                WHEN e.is_directory = 1 THEN COALESCE(r.recursive_size_bytes, 0)
                ELSE e.size
            END AS size,
            e.is_directory,
            CASE
                WHEN e.is_directory = 1 THEN COALESCE(r.recursive_file_count, 0)
                ELSE 0
            END AS recursive_file_count
        FROM filesystem.entries AS e
        LEFT JOIN filesystem.directory_recursive_sizes AS r
            ON e.snapshot_date = r.snapshot_date AND e.path = r.path
        WHERE e.snapshot_date = %(date)s
          AND e.path LIKE %(root)s
        ORDER BY e.path ASC
        """
        
        stream = client.execute_iter(
            query, 
            {"date": self.snapshot_date.isoformat(), "root": self.root_path + "%"}
        )

        # Initialize Stack
        # Logic: We manually create the root node container to start the stack
        root_id = self._generate_id(self.root_path, True)
        root_node = {
            "id": root_id,
            "name": self.root_path.split("/")[-1] or "root",
            "path": self.root_path,
            "size": 0,
            "is_directory": True,
            "depth": 0,  # Root always has depth 0
            "file_count": 0,
            "children_ids": [],
            "files": [],
            "parent_id": "",  # Root has no parent
        }
        
        stack = [(self.root_path, root_node)]
        nodes_processed = 0

        for row in stream:
            path, name, size, is_directory, recursive_file_count = row
            nodes_processed += 1

            # 1. Stack Management: Close nodes that are done
            # While current path is NOT a child of stack top...
            while stack and not path.startswith(stack[-1][0] + "/"):
                _, finished_node = stack.pop()
                # Don't propagate - we're using pre-calculated recursive counts
                self._finalize_and_insert(finished_node)

            if not stack: continue # Should not happen

            parent_path, parent_node = stack[-1]

            # If row IS the root itself (due to LIKE match), update info
            if path == self.root_path:
                parent_node['size'] = size
                parent_node['file_count'] = recursive_file_count
                continue

            # 2. Process New Item
            # Create Node Object
            node_id = self._generate_id(path, is_directory)
            depth = self._calculate_depth(path)  # Use relative depth

            if is_directory:
                new_node = {
                    "id": node_id, "name": name, "path": path, "size": size,
                    "is_directory": True, "depth": depth, "file_count": recursive_file_count,
                    "children_ids": [], "files": [],
                    "parent_id": parent_node["id"]  # Track parent
                }
                parent_node["children_ids"].append(node_id)
                stack.append((path, new_node)) # Push to stack
            else:
                # File: Don't create DB node yet, just add to parent's file list
                parent_node["files"].append({
                    "name": name, "path": path, "size": size
                })
                # Don't increment file_count - using pre-calculated recursive count

        client.disconnect()

        # Finalize remaining stack
        while stack:
            _, node = stack.pop()
            # Don't propagate - we're using pre-calculated recursive counts
            self._finalize_and_insert(node)

        # Flush final batch
        self.storage.flush()
        
        return {
            "status": "success", 
            "path": self.root_path, 
            "processed": nodes_processed, 
            "inserted": self.storage.total_inserted
        }

    def _finalize_and_insert(self, node: dict):
        """Prepare node and send to storage class."""
        
        # Handle __files__ grouping (Synthetic Node)
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

        # Insert the Directory Node itself
        # IMPORTANT: Also store original_files on the directory node for frontend compatibility
        # This allows the frontend to show file bubbles directly without needing to fetch __files__ children
        self.storage.add_node(
            snapshot_date=self.snapshot_date,
            node_id=node["id"],
            parent_id=node.get("parent_id", ""),  # Use tracked parent_id
            path=node["path"],
            name=node["name"],
            size=node["size"],
            depth=node["depth"],
            is_directory=node["is_directory"],
            file_count=node["file_count"],
            children_ids=node["children_ids"],
            is_synthetic=False,
            original_files=node["files"] if node["files"] else None  # Store files on directory too
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
    query = f"""
    SELECT child_path FROM filesystem.directory_hierarchy
    WHERE snapshot_date = '{snapshot_date.isoformat()}'
      AND parent_path = '{root_path}'
      AND is_directory = 1
    """
    try:
        result = client.execute(query)
        return [row[0] for row in result]
    except Exception as e:
        logger.error(f"Error fetching subdirectories: {e}")
        return []
    finally:
        client.disconnect()

def main():
    parser = argparse.ArgumentParser(description="Unified Voronoi Computer")
    parser.add_argument("snapshot_date", type=str, help="YYYY-MM-DD")
    parser.add_argument("--workers", type=int, default=1, help="Parallel workers")
    parser.add_argument("--force", action="store_true", help="Delete old data")
    parser.add_argument("--root", default="/project/cil", help="Root path")
    # DB connection args
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--user", default="default")
    parser.add_argument("--password", default="")
    parser.add_argument("--database", default="filesystem")

    args = parser.parse_args()

    # DB Config Dictionary
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
        
        # Get sub-tasks
        subfolders = fetch_subdirectories(snap_date, args.root, db_config)
        
        if not subfolders:
            logger.warning("No subfolders found. Falling back to sequential.")
            tasks = []
        else:
            logger.info(f"Distributing {len(subfolders)} sub-trees.")
            tasks = [(snap_date, folder, db_config) for folder in subfolders]

        # Also need to process the root itself (shallow)
        # For simplicity in this script, we assume the workers cover the heavy lifting
        # and we run one quick pass on the root path in the main process?
        # Better: Just run the workers. 
        
        total_inserted = 0
        
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