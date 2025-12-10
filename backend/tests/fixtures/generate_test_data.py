"""Generate test parquet files for testing."""

import polars as pl
from datetime import datetime, timedelta
from pathlib import Path
import random


def generate_mock_snapshot(
    num_files: int = 1000,
    snapshot_date: str = "2024-01-15",
    top_dirs: list[str] = None
) -> pl.DataFrame:
    """
    Generate mock snapshot data.

    Args:
        num_files: Number of files to generate
        snapshot_date: Snapshot date
        top_dirs: List of top-level directories

    Returns:
        Polars DataFrame with mock data
    """
    if top_dirs is None:
        top_dirs = ["cil", "battuta_shares", "gcp", "home_dirs"]

    file_types = [".txt", ".pdf", ".py", ".csv", ".json", ".log", ".bin", ".tar.gz", ".zip", ".md"]

    data = []
    for i in range(num_files):
        top_dir = random.choice(top_dirs)
        depth = random.randint(1, 5)
        file_type = random.choice(file_types)

        path_parts = [top_dir] + [f"dir{random.randint(1,10)}" for _ in range(depth)] + [f"file{i}{file_type}"]
        path = "/" + "/".join(path_parts)

        # Generate realistic file sizes with distribution
        if random.random() < 0.7:  # 70% small files
            size = random.randint(1024, 1024 * 1024)  # 1KB to 1MB
        elif random.random() < 0.95:  # 25% medium files
            size = random.randint(1024 * 1024, 100 * 1024 * 1024)  # 1MB to 100MB
        else:  # 5% large files
            size = random.randint(100 * 1024 * 1024, 10 * 1024 * 1024 * 1024)  # 100MB to 10GB

        data.append({
            "snapshot_date": snapshot_date,
            "path": path,
            "size": size,
            "modified_time": datetime.now() - timedelta(days=random.randint(0, 365)),
            "accessed_time": datetime.now() - timedelta(days=random.randint(0, 30)),
            "created_time": datetime.now() - timedelta(days=random.randint(365, 730)),
            "file_type": file_type.lstrip("."),
            "inode": random.randint(1000000, 9999999),
            "permissions": random.choice([420, 644, 755]),
            "parent_path": "/" + "/".join(path_parts[:-1]),
            "depth": depth + 1,
            "top_level_dir": top_dir,
        })

    return pl.DataFrame(data)


def generate_multiple_snapshots(
    num_snapshots: int = 3,
    files_per_snapshot: int = 1000,
    output_dir: str = "tests/fixtures/sample_snapshots"
) -> None:
    """
    Generate multiple snapshots for time-series testing.

    Args:
        num_snapshots: Number of snapshots to generate
        files_per_snapshot: Files per snapshot
        output_dir: Output directory
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    base_date = datetime(2024, 1, 1)

    for i in range(num_snapshots):
        snapshot_date = (base_date + timedelta(days=i * 30)).strftime("%Y-%m-%d")
        print(f"Generating snapshot: {snapshot_date}")

        df = generate_mock_snapshot(
            num_files=files_per_snapshot,
            snapshot_date=snapshot_date
        )

        # Create date directory
        date_dir = output_path / snapshot_date
        date_dir.mkdir(parents=True, exist_ok=True)

        # Save parquet file
        parquet_path = date_dir / f"snapshot_{snapshot_date}.parquet"
        df.write_parquet(parquet_path)

        print(f"  Saved: {parquet_path}")
        print(f"  Files: {len(df)}")
        print(f"  Total size: {df['size'].sum():,} bytes")
        print()

    print(f"Generated {num_snapshots} snapshots in {output_dir}")


if __name__ == "__main__":
    generate_multiple_snapshots(
        num_snapshots=3,
        files_per_snapshot=1000,
        output_dir="tests/fixtures/sample_snapshots"
    )
