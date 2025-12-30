#!/usr/bin/env python3
"""
Initialize ClickHouse database schema.

This script:
1. Creates filesystem database
2. Creates main tables
3. Creates materialized views
4. Creates indexes
5. Verifies schema

Usage:
    python setup_database.py
"""

import time
import logging
from pathlib import Path
from clickhouse_driver import Client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def execute_sql_file(client: Client, sql_file: Path):
    """Execute SQL file, splitting by statements."""
    logger.info(f"Executing {sql_file.name}...")

    sql_content = sql_file.read_text()

    # Remove comments (keep it simple)
    lines = []
    for line in sql_content.split('\n'):
        # Remove inline comments
        if '--' in line:
            line = line[:line.index('--')]
        line = line.strip()
        if line:
            lines.append(line)

    sql_content = ' '.join(lines)

    # Split by semicolons
    statements = [s.strip() for s in sql_content.split(';') if s.strip()]

    executed = 0
    skipped = 0
    errors = 0

    for statement in statements:
        if not statement:
            continue

        # Log first 80 chars of statement
        log_statement = statement[:80].replace('\n', ' ')
        logger.debug(f"  Executing: {log_statement}...")

        try:
            client.execute(statement)
            executed += 1
            logger.debug(f"    ✓ Success")
        except Exception as e:
            # Some statements may fail if objects already exist
            error_str = str(e).lower()
            if 'already exists' in error_str:
                skipped += 1
                logger.debug(f"    → Skipped (already exists)")
            elif 'does not exist' in error_str and 'alter table' in statement.lower():
                skipped += 1
                logger.debug(f"    → Skipped (table doesn't exist yet for ALTER)")
            elif 'is not supported by storage materializedview' in error_str:
                skipped += 1
                logger.debug(f"    → Skipped (cannot alter materialized view)")
            else:
                errors += 1
                logger.warning(f"    ✗ Error: {e}")

    logger.info(f"  Executed: {executed}, Skipped: {skipped}, Errors: {errors}")


def setup_database(host='localhost', port=9000):
    """Set up ClickHouse database schema."""
    logger.info("Setting up ClickHouse database schema...")
    logger.info(f"Connecting to {host}:{port}")

    client = Client(host=host, port=port)

    # Get schema directory
    script_dir = Path(__file__).parent
    schema_dir = script_dir.parent / 'schema'

    if not schema_dir.exists():
        raise FileNotFoundError(f"Schema directory not found: {schema_dir}")

    # Execute schema files in order
    schema_files = sorted(schema_dir.glob("*.sql"))

    if not schema_files:
        raise FileNotFoundError(f"No SQL files found in {schema_dir}")

    logger.info(f"Found {len(schema_files)} schema files")

    for sql_file in schema_files:
        execute_sql_file(client, sql_file)

    # Verify setup
    logger.info("Verifying database setup...")

    # Check database exists
    databases = client.execute("SHOW DATABASES")
    if ('filesystem',) not in databases:
        logger.error("  ERROR: filesystem database not created!")
        return False

    logger.info("  ✓ Database 'filesystem' exists")

    # Check tables
    tables = client.execute("SHOW TABLES FROM filesystem")
    expected_tables = [
        'entries',
        'snapshots',
        'search_index',
        'voronoi_precomputed',
    ]

    for table in expected_tables:
        if (table,) in tables:
            logger.info(f"  ✓ Table 'filesystem.{table}' exists")
        else:
            logger.warning(f"  ✗ Table 'filesystem.{table}' NOT found")

    # Check materialized views
    views_query = """
        SELECT name
        FROM system.tables
        WHERE database = 'filesystem'
          AND engine LIKE '%MergeTree%'
          AND name NOT IN ('entries', 'snapshots', 'search_index', 'voronoi_precomputed')
    """

    views = client.execute(views_query)
    logger.info(f"  ✓ Found {len(views)} materialized views")

    for (view_name,) in views:
        logger.info(f"    - {view_name}")

    logger.info("=" * 60)
    logger.info("Database setup completed successfully!")
    logger.info("")
    logger.info("Next steps:")
    logger.info("  1. Import snapshot data:")
    logger.info("       python scripts/import_snapshot.py /path/to/snapshot/2025-12-12")
    logger.info("  2. Verify import:")
    logger.info("       clickhouse-client --query 'SELECT count() FROM filesystem.entries'")
    logger.info("=" * 60)

    client.disconnect()
    return True


def main():
    """Main entry point."""
    try:
        success = setup_database()
        if success:
            return 0
        else:
            return 1
    except Exception as e:
        logger.error(f"Setup failed: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
