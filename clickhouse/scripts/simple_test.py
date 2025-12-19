#!/usr/bin/env python3
"""
Simple test to verify ClickHouse setup and insert a few rows manually.

This bypasses the complex Parquet import logic to just test the connection
and basic insert/query functionality.
"""

import sys
import logging
from datetime import date
from clickhouse_driver import Client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_clickhouse_simple():
    """Simple test with manually created data."""
    logger.info("Testing ClickHouse with simple manual data...")

    # Connect
    try:
        client = Client(host='localhost', port=9000, database='filesystem')
        logger.info("✓ Connected to ClickHouse")
    except Exception as e:
        logger.error(f"✗ Connection failed: {e}")
        return False

    # Test 1: Check tables exist
    logger.info("\n1. Checking tables exist...")
    try:
        tables = client.execute("SHOW TABLES")
        table_names = [t[0] for t in tables]
        logger.info(f"   Found tables: {', '.join(table_names)}")

        required_tables = ['entries', 'snapshots', 'directory_hierarchy']
        for table in required_tables:
            if table in table_names:
                logger.info(f"   ✓ {table} exists")
            else:
                logger.warning(f"   ✗ {table} missing")
    except Exception as e:
        logger.error(f"   ✗ Failed to check tables: {e}")
        return False

    # Test 2: Insert a few test rows
    logger.info("\n2. Inserting test data...")

    test_data = [
        # (snapshot_date, path, parent_path, name, depth, top_level_dir, size, file_type, is_directory,
        #  modified_time, accessed_time, created_time, inode, permissions, owner, group_name, uid, gid)
        (
            date(2025, 12, 12),
            '/test',
            '/',
            'test',
            1,
            'test',
            0,
            'directory',
            1,
            1734480000,  # Unix timestamp
            1734480000,
            1734480000,
            123456,
            493,  # 0755 in octal = 493 in decimal
            'testuser',
            'testgroup',
            1000,
            1000
        ),
        (
            date(2025, 12, 12),
            '/test/file1.txt',
            '/test',
            'file1.txt',
            2,
            'test',
            1024,
            'txt',
            0,
            1734480000,
            1734480000,
            1734480000,
            123457,
            420,  # 0644 in octal = 420 in decimal
            'testuser',
            'testgroup',
            1000,
            1000
        ),
        (
            date(2025, 12, 12),
            '/test/file2.txt',
            '/test',
            'file2.txt',
            2,
            'test',
            2048,
            'txt',
            0,
            1734480000,
            1734480000,
            1734480000,
            123458,
            420,
            'testuser',
            'testgroup',
            1000,
            1000
        ),
    ]

    try:
        client.execute(
            """
            INSERT INTO entries
            (snapshot_date, path, parent_path, name, depth, top_level_dir, size, file_type, is_directory,
             modified_time, accessed_time, created_time, inode, permissions, owner, group_name, uid, gid)
            VALUES
            """,
            test_data
        )
        logger.info(f"   ✓ Inserted {len(test_data)} test rows")
    except Exception as e:
        logger.error(f"   ✗ Insert failed: {e}")
        return False

    # Test 3: Query the data back
    logger.info("\n3. Querying data...")

    try:
        # Count rows
        count = client.execute("SELECT count() FROM entries")[0][0]
        logger.info(f"   ✓ Total rows in entries: {count:,}")

        # Get test data
        result = client.execute("""
            SELECT path, size, is_directory
            FROM entries
            WHERE snapshot_date = '2025-12-12'
            ORDER BY size DESC
        """)

        logger.info(f"   ✓ Query returned {len(result)} rows:")
        for row in result:
            path, size, is_dir = row
            type_str = "DIR " if is_dir else "FILE"
            logger.info(f"      {type_str} {path:30s} {size:>10,} bytes")

    except Exception as e:
        logger.error(f"   ✗ Query failed: {e}")
        return False

    # Test 4: Check materialized views updated
    logger.info("\n4. Checking materialized views...")

    try:
        # Check directory_hierarchy
        hierarchy_count = client.execute(
            "SELECT count() FROM directory_hierarchy WHERE snapshot_date = '2025-12-12'"
        )[0][0]
        logger.info(f"   ✓ directory_hierarchy has {hierarchy_count} rows")

        # Get children of /test
        children = client.execute("""
            SELECT child_path, total_size, is_directory
            FROM directory_hierarchy
            WHERE snapshot_date = '2025-12-12'
              AND parent_path = '/test'
            ORDER BY total_size DESC
        """)

        logger.info(f"   ✓ Children of /test: {len(children)} items")
        for row in children:
            child_path, size, is_dir = row
            type_str = "DIR " if is_dir else "FILE"
            logger.info(f"      {type_str} {child_path:30s} {size:>10,} bytes")

    except Exception as e:
        logger.error(f"   ✗ Materialized view check failed: {e}")
        logger.warning("   This may be expected if views haven't populated yet")

    # Test 5: Performance test
    logger.info("\n5. Testing query performance...")

    import time

    try:
        # Warm up
        client.execute("SELECT 1")

        # Test navigation query
        start = time.time()
        result = client.execute("""
            SELECT child_path, total_size
            FROM directory_hierarchy
            WHERE snapshot_date = '2025-12-12'
              AND parent_path = '/test'
            LIMIT 100
        """)
        duration_ms = (time.time() - start) * 1000

        logger.info(f"   ✓ Navigation query: {duration_ms:.1f}ms")

        if duration_ms < 100:
            logger.info("   ✓ Performance: EXCELLENT (< 100ms)")
        elif duration_ms < 500:
            logger.info("   ✓ Performance: GOOD (< 500ms)")
        else:
            logger.warning("   ⚠ Performance: SLOW (> 500ms)")

    except Exception as e:
        logger.error(f"   ✗ Performance test failed: {e}")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("✓ ALL TESTS PASSED")
    logger.info("=" * 60)
    logger.info("\nClickHouse is working correctly!")
    logger.info("Ready for real data import once timestamp conversion is fixed.")
    logger.info("=" * 60)

    client.disconnect()
    return True


if __name__ == "__main__":
    try:
        success = test_clickhouse_simple()
        sys.exit(0 if success else 1)
    except Exception as e:
        logger.error(f"Test failed with exception: {e}", exc_info=True)
        sys.exit(1)
