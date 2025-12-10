#!/usr/bin/env python3

"""
Scan Wrapper - Automates storage scanning with Slurm
Provides scheduling, monitoring, and reporting capabilities
"""

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional


class ScanScheduler:
    """Manages scheduling and execution of storage scans"""

    def __init__(
        self,
        scanner_bin: Path,
        snapshot_dir: Path,
        log_dir: Path,
        slurm_script: Path,
    ):
        self.scanner_bin = scanner_bin
        self.snapshot_dir = snapshot_dir
        self.log_dir = log_dir
        self.slurm_script = slurm_script

    def submit_scan_job(
        self,
        cpus: int = 16,
        memory: str = "8G",
        time_limit: str = "4:00:00",
        dry_run: bool = False,
    ) -> Optional[int]:
        """Submit a Slurm job array for scanning"""

        # Ensure directories exist
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir.mkdir(parents=True, exist_ok=True)

        # Check if scanner binary exists
        if not self.scanner_bin.exists():
            print(f"Error: Scanner binary not found at {self.scanner_bin}")
            print("Please build the scanner first with: cargo build --release")
            return None

        # Prepare environment variables
        env_vars = {
            "SCANNER_BIN": str(self.scanner_bin),
            "SNAPSHOT_DIR": str(self.snapshot_dir),
            "LOG_DIR": str(self.log_dir),
        }

        # Build sbatch command
        cmd = [
            "sbatch",
            f"--cpus-per-task={cpus}",
            f"--mem={memory}",
            f"--time={time_limit}",
            str(self.slurm_script),
        ]

        print("Submitting Slurm job array")
        print("Configuration:")
        print(f"  Scanner binary: {self.scanner_bin}")
        print(f"  Snapshot directory: {self.snapshot_dir}")
        print(f"  Log directory: {self.log_dir}")
        print(f"  CPUs per task: {cpus}")
        print(f"  Memory: {memory}")
        print(f"  Time limit: {time_limit}")
        print()

        if dry_run:
            print("Dry run - command that would be executed:")
            print(" ".join(cmd))
            print("\nEnvironment variables:")
            for key, value in env_vars.items():
                print(f"  {key}={value}")
            return None

        # Submit job
        try:
            import os

            env = os.environ.copy()
            env.update(env_vars)

            result = subprocess.run(
                cmd, env=env, capture_output=True, text=True, check=True
            )

            # Parse job ID from output
            output = result.stdout.strip()
            print(output)

            # Extract job ID (format: "Submitted batch job 12345")
            if "Submitted batch job" in output:
                job_id = int(output.split()[-1])
                print(f"\nJob ID: {job_id}")
                print(f"\nMonitor job status with: squeue -j {job_id}")
                print(f"View logs in: {self.log_dir}")
                return job_id

        except subprocess.CalledProcessError as e:
            print(f"Error submitting job: {e}")
            print(f"stdout: {e.stdout}")
            print(f"stderr: {e.stderr}")
            return None

        return None

    def check_job_status(self, job_id: int) -> None:
        """Check the status of a running job"""
        try:
            result = subprocess.run(
                ["squeue", "-j", str(job_id)],
                capture_output=True,
                text=True,
                check=True,
            )
            print(result.stdout)
        except subprocess.CalledProcessError as e:
            print(f"Error checking job status: {e}")

    def list_snapshots(self) -> List[Path]:
        """List available snapshots"""
        if not self.snapshot_dir.exists():
            return []

        snapshots = sorted(self.snapshot_dir.glob("*.parquet"))
        return snapshots

    def get_snapshot_info(self, snapshot: Path) -> dict:
        """Get information about a snapshot file"""
        stat = snapshot.stat()
        return {
            "name": snapshot.name,
            "size": stat.st_size,
            "size_mb": stat.st_size / (1024 * 1024),
            "modified": datetime.fromtimestamp(stat.st_mtime),
        }


def main():
    parser = argparse.ArgumentParser(
        description="Storage scanner Slurm job scheduler"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Submit command
    submit_parser = subparsers.add_parser("submit", help="Submit a scan job")
    submit_parser.add_argument(
        "--scanner-bin",
        type=Path,
        default=Path("./target/release/storage-scanner"),
        help="Path to scanner binary",
    )
    submit_parser.add_argument(
        "--snapshot-dir",
        type=Path,
        default=Path(f"/snapshots/{datetime.now().strftime('%Y-%m-%d')}"),
        help="Snapshot output directory",
    )
    submit_parser.add_argument(
        "--log-dir", type=Path, default=Path("./logs"), help="Log directory"
    )
    submit_parser.add_argument(
        "--slurm-script",
        type=Path,
        default=Path("./scanner/scripts/slurm_scan.sh"),
        help="Path to Slurm script",
    )
    submit_parser.add_argument(
        "--cpus", type=int, default=16, help="CPUs per task"
    )
    submit_parser.add_argument(
        "--memory", type=str, default="8G", help="Memory per task"
    )
    submit_parser.add_argument(
        "--time", type=str, default="4:00:00", help="Time limit"
    )
    submit_parser.add_argument(
        "--dry-run", action="store_true", help="Show what would be executed"
    )

    # Status command
    status_parser = subparsers.add_parser("status", help="Check job status")
    status_parser.add_argument("job_id", type=int, help="Slurm job ID")

    # List command
    list_parser = subparsers.add_parser("list", help="List snapshots")
    list_parser.add_argument(
        "--snapshot-dir",
        type=Path,
        default=Path("/snapshots"),
        help="Snapshot directory",
    )

    args = parser.parse_args()

    if args.command == "submit":
        scheduler = ScanScheduler(
            scanner_bin=args.scanner_bin,
            snapshot_dir=args.snapshot_dir,
            log_dir=args.log_dir,
            slurm_script=args.slurm_script,
        )

        job_id = scheduler.submit_scan_job(
            cpus=args.cpus,
            memory=args.memory,
            time_limit=args.time,
            dry_run=args.dry_run,
        )

        if job_id:
            sys.exit(0)
        else:
            sys.exit(1)

    elif args.command == "status":
        scheduler = ScanScheduler(
            scanner_bin=Path(""),
            snapshot_dir=Path(""),
            log_dir=Path(""),
            slurm_script=Path(""),
        )
        scheduler.check_job_status(args.job_id)

    elif args.command == "list":
        scheduler = ScanScheduler(
            scanner_bin=Path(""),
            snapshot_dir=args.snapshot_dir,
            log_dir=Path(""),
            slurm_script=Path(""),
        )

        snapshots = scheduler.list_snapshots()

        if not snapshots:
            print("No snapshots found")
            return

        print(f"Snapshots in {args.snapshot_dir}:")
        print()

        total_size = 0
        for snapshot in snapshots:
            info = scheduler.get_snapshot_info(snapshot)
            print(
                f"{info['name']:40} {info['size_mb']:>10.2f} MB  {info['modified']}"
            )
            total_size += info["size"]

        print()
        print(f"Total: {len(snapshots)} snapshots, {total_size / (1024**3):.2f} GB")


if __name__ == "__main__":
    main()
