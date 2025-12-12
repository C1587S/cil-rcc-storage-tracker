#!/usr/bin/env python3
"""
Generate Mock Filesystem for Testing

Creates a realistic mock filesystem structure that mirrors the RCC /project/cil
directory structure. This allows for end-to-end testing of the complete pipeline
without requiring access to the actual RCC cluster.

Usage:
    python generate_test_data.py [--output-dir PATH] [--files-per-dir NUM]
"""

import argparse
import random
import string
from pathlib import Path
from datetime import datetime, timedelta


def random_string(length=8):
    """Generate a random string of letters and numbers."""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))


def generate_research_content():
    """Generate realistic research-like file content."""
    content_types = [
        "# Research Data\nSample: {}\nDate: {}\n",
        "ID,Value,Timestamp\n{},{},{}\n",
        "Results from experiment {}\nStatus: Complete\n",
        "Dataset version {}\nCreated: {}\n",
    ]
    template = random.choice(content_types)
    return template.format(
        random_string(6),
        datetime.now().isoformat(),
        random.randint(1000, 9999)
    )


def create_file(filepath, size_kb=None):
    """Create a file with optional target size."""
    if size_kb:
        content = generate_research_content() * (size_kb * 100)
    else:
        content = generate_research_content()

    filepath.write_text(content)


def generate_directory_structure(base_path, config):
    """
    Generate a multi-level directory structure.

    Args:
        base_path: Root path for generation
        config: Dictionary with structure configuration
    """
    base_path = Path(base_path)
    base_path.mkdir(parents=True, exist_ok=True)

    print(f"Generating directory structure in: {base_path}")

    # Create subdirectories
    for i in range(config['subdirs']):
        subdir = base_path / f"subdir_{i:03d}"
        subdir.mkdir(exist_ok=True)

        # Create files in subdirectory
        for j in range(config['files_per_subdir']):
            ext = random.choice(['.txt', '.csv', '.dat', '.log', '.json'])
            filename = f"file_{j:04d}{ext}"
            filepath = subdir / filename

            # Vary file sizes
            if random.random() < 0.1:  # 10% large files
                create_file(filepath, size_kb=random.randint(100, 1000))
            else:
                create_file(filepath)

        # Create nested structure
        if config['nesting_levels'] > 0:
            nested_config = {
                'subdirs': max(1, config['subdirs'] // 2),
                'files_per_subdir': config['files_per_subdir'],
                'nesting_levels': config['nesting_levels'] - 1
            }
            generate_directory_structure(
                subdir / "nested",
                nested_config
            )


def generate_user_directories(base_path, num_users, files_per_user):
    """Generate user home directories structure."""
    base_path = Path(base_path)
    base_path.mkdir(parents=True, exist_ok=True)

    print(f"Generating {num_users} user directories...")

    for i in range(num_users):
        username = f"user{i:03d}"
        user_dir = base_path / username
        user_dir.mkdir(exist_ok=True)

        # Common user directories
        for subdir in ['documents', 'data', 'scripts', 'results']:
            (user_dir / subdir).mkdir(exist_ok=True)

            # Add files to each directory
            for j in range(files_per_user // 4):
                ext = random.choice(['.txt', '.py', '.sh', '.csv', '.dat'])
                filepath = user_dir / subdir / f"{subdir}_{j:03d}{ext}"
                create_file(filepath)


def generate_project_data(base_path, num_projects, files_per_project):
    """Generate project directories with research data."""
    base_path = Path(base_path)
    base_path.mkdir(parents=True, exist_ok=True)

    print(f"Generating {num_projects} project directories...")

    for i in range(num_projects):
        project_name = f"project_{i:02d}_{random_string(4)}"
        project_dir = base_path / project_name
        project_dir.mkdir(exist_ok=True)

        # Project structure
        for subdir in ['raw_data', 'processed', 'analysis', 'outputs']:
            (project_dir / subdir).mkdir(exist_ok=True)

            for j in range(files_per_project // 4):
                ext = random.choice(['.csv', '.parquet', '.json', '.txt'])
                filepath = project_dir / subdir / f"data_{j:04d}{ext}"

                # Larger files for data directories
                if subdir in ['raw_data', 'processed']:
                    create_file(filepath, size_kb=random.randint(50, 500))
                else:
                    create_file(filepath)


def main():
    parser = argparse.ArgumentParser(
        description='Generate mock filesystem for testing'
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        default='./test_data',
        help='Output directory for test data (default: ./test_data)'
    )
    parser.add_argument(
        '--scale',
        type=str,
        choices=['small', 'medium', 'large'],
        default='small',
        help='Scale of test data (small/medium/large)'
    )

    args = parser.parse_args()

    # Define scale configurations
    scales = {
        'small': {
            'users': 10,
            'files_per_user': 20,
            'projects': 5,
            'files_per_project': 40,
            'gcp_subdirs': 3,
            'gcp_files': 15,
            'gcp_nesting': 2,
            'shares_subdirs': 3,
            'shares_files': 20,
            'shares_nesting': 2,
        },
        'medium': {
            'users': 50,
            'files_per_user': 40,
            'projects': 20,
            'files_per_project': 100,
            'gcp_subdirs': 10,
            'gcp_files': 30,
            'gcp_nesting': 3,
            'shares_subdirs': 10,
            'shares_files': 40,
            'shares_nesting': 3,
        },
        'large': {
            'users': 100,
            'files_per_user': 100,
            'projects': 50,
            'files_per_project': 200,
            'gcp_subdirs': 20,
            'gcp_files': 50,
            'gcp_nesting': 4,
            'shares_subdirs': 20,
            'shares_files': 60,
            'shares_nesting': 4,
        },
    }

    config = scales[args.scale]
    output_dir = Path(args.output_dir)

    print("=" * 70)
    print("Mock Filesystem Generator")
    print("=" * 70)
    print(f"Scale:      {args.scale}")
    print(f"Output dir: {output_dir}")
    print("=" * 70)
    print()

    # Create root directory structure (mimics /project/cil)
    root = output_dir / "project_cil"
    root.mkdir(parents=True, exist_ok=True)

    # Generate home_dirs (user directories)
    print("\n[1/3] Generating home_dirs...")
    generate_user_directories(
        root / "home_dirs",
        config['users'],
        config['files_per_user']
    )

    # Generate gcp (research projects)
    print("\n[2/3] Generating gcp...")
    generate_project_data(
        root / "gcp",
        config['projects'],
        config['files_per_project']
    )

    # Generate battuta_shares (shared data)
    print("\n[3/3] Generating battuta_shares...")
    generate_directory_structure(
        root / "battuta_shares",
        {
            'subdirs': config['shares_subdirs'],
            'files_per_subdir': config['shares_files'],
            'nesting_levels': config['shares_nesting']
        }
    )

    # Generate summary
    print("\n" + "=" * 70)
    print("Generation Complete")
    print("=" * 70)

    # Count files and directories
    total_files = sum(1 for _ in root.rglob('*') if _.is_file())
    total_dirs = sum(1 for _ in root.rglob('*') if _.is_dir())
    total_size = sum(f.stat().st_size for f in root.rglob('*') if f.is_file())

    print(f"Total directories: {total_dirs:,}")
    print(f"Total files:       {total_files:,}")
    print(f"Total size:        {total_size / (1024**2):.2f} MB")
    print(f"Root directory:    {root}")
    print()
    print("Test data structure:")
    print(f"  {root}/")
    print(f"    ├── home_dirs/      ({config['users']} users)")
    print(f"    ├── gcp/            ({config['projects']} projects)")
    print(f"    └── battuta_shares/ ({config['shares_subdirs']} directories)")
    print("=" * 70)
    print()
    print("Next steps:")
    print("  1. Run test suite: ./run_integration_test.sh")
    print(f"  2. Or scan manually: scanner scan --path {root} --output scan.parquet")
    print()


if __name__ == '__main__':
    main()
