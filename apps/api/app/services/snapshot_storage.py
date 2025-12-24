"""
Snapshot storage service for managing voronoi artifacts on disk.

Handles reading/writing voronoi.json artifacts to the /snapshots directory.
"""

import json
import logging
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional
from dataclasses import asdict

logger = logging.getLogger(__name__)

# Repository root (assuming we're in apps/api/app/services)
REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
SNAPSHOTS_DIR = REPO_ROOT / "snapshots"


class SnapshotStorage:
    """
    Manages storage of snapshot artifacts on disk.
    """

    def __init__(self, base_dir: Optional[Path] = None):
        """
        Initialize storage service.

        Args:
            base_dir: Base directory for snapshots (default: repo_root/snapshots)
        """
        self.base_dir = base_dir or SNAPSHOTS_DIR
        logger.info(f"SnapshotStorage initialized with base_dir: {self.base_dir}")

    def _get_snapshot_dir(self, snapshot_date: date) -> Path:
        """Get the directory path for a specific snapshot."""
        return self.base_dir / snapshot_date.isoformat()

    def _get_voronoi_artifact_path(self, snapshot_date: date) -> Path:
        """Get the file path for the voronoi artifact."""
        return self._get_snapshot_dir(snapshot_date) / "voronoi.json"

    def _get_metadata_path(self, snapshot_date: date) -> Path:
        """Get the file path for snapshot metadata."""
        return self._get_snapshot_dir(snapshot_date) / "metadata.json"

    def ensure_snapshot_dir(self, snapshot_date: date) -> Path:
        """
        Ensure snapshot directory exists, create if necessary.

        Args:
            snapshot_date: The snapshot date

        Returns:
            Path to the snapshot directory
        """
        snapshot_dir = self._get_snapshot_dir(snapshot_date)
        snapshot_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Ensured snapshot directory exists: {snapshot_dir}")
        return snapshot_dir

    def save_voronoi_artifact(
        self, snapshot_date: date, artifact: Any, validate: bool = True
    ) -> Path:
        """
        Save voronoi artifact to disk.

        Args:
            snapshot_date: The snapshot date
            artifact: VoronoiArtifact object (will be converted to dict)
            validate: Whether to validate the artifact structure

        Returns:
            Path to the saved file

        Raises:
            ValueError: If validation fails
            IOError: If file write fails
        """
        # Ensure directory exists
        self.ensure_snapshot_dir(snapshot_date)

        # Convert artifact to dict if needed
        if hasattr(artifact, "__dict__"):
            artifact_dict = asdict(artifact)
        else:
            artifact_dict = artifact

        # Validate structure
        if validate:
            self._validate_artifact(artifact_dict)

        # Write to file atomically (write to temp, then rename)
        artifact_path = self._get_voronoi_artifact_path(snapshot_date)
        temp_path = artifact_path.with_suffix(".json.tmp")

        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(artifact_dict, f, indent=2, ensure_ascii=False)

            # Atomic rename
            temp_path.replace(artifact_path)
            logger.info(f"Saved voronoi artifact to {artifact_path}")
            return artifact_path

        except Exception as e:
            # Clean up temp file on failure
            if temp_path.exists():
                temp_path.unlink()
            logger.error(f"Failed to save voronoi artifact: {e}")
            raise IOError(f"Failed to save voronoi artifact: {e}")

    def load_voronoi_artifact(self, snapshot_date: date) -> Optional[Dict[str, Any]]:
        """
        Load voronoi artifact from disk.

        Args:
            snapshot_date: The snapshot date

        Returns:
            Artifact dict or None if not found
        """
        artifact_path = self._get_voronoi_artifact_path(snapshot_date)

        if not artifact_path.exists():
            logger.warning(f"Voronoi artifact not found: {artifact_path}")
            return None

        try:
            with open(artifact_path, "r", encoding="utf-8") as f:
                artifact = json.load(f)
            logger.info(f"Loaded voronoi artifact from {artifact_path}")
            return artifact
        except Exception as e:
            logger.error(f"Failed to load voronoi artifact: {e}")
            return None

    def artifact_exists(self, snapshot_date: date) -> bool:
        """
        Check if voronoi artifact exists for a snapshot.

        Args:
            snapshot_date: The snapshot date

        Returns:
            True if artifact exists, False otherwise
        """
        return self._get_voronoi_artifact_path(snapshot_date).exists()

    def save_metadata(self, snapshot_date: date, metadata: Dict[str, Any]) -> Path:
        """
        Save snapshot metadata to disk.

        Args:
            snapshot_date: The snapshot date
            metadata: Metadata dict to save

        Returns:
            Path to the saved file
        """
        # Ensure directory exists
        self.ensure_snapshot_dir(snapshot_date)

        metadata_path = self._get_metadata_path(snapshot_date)
        temp_path = metadata_path.with_suffix(".json.tmp")

        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2, ensure_ascii=False)

            # Atomic rename
            temp_path.replace(metadata_path)
            logger.info(f"Saved metadata to {metadata_path}")
            return metadata_path

        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            logger.error(f"Failed to save metadata: {e}")
            raise IOError(f"Failed to save metadata: {e}")

    def load_metadata(self, snapshot_date: date) -> Optional[Dict[str, Any]]:
        """
        Load snapshot metadata from disk.

        Args:
            snapshot_date: The snapshot date

        Returns:
            Metadata dict or None if not found
        """
        metadata_path = self._get_metadata_path(snapshot_date)

        if not metadata_path.exists():
            logger.warning(f"Metadata not found: {metadata_path}")
            return None

        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
            logger.info(f"Loaded metadata from {metadata_path}")
            return metadata
        except Exception as e:
            logger.error(f"Failed to load metadata: {e}")
            return None

    def _validate_artifact(self, artifact: Dict[str, Any]) -> None:
        """
        Validate artifact structure.

        Args:
            artifact: The artifact dict to validate

        Raises:
            ValueError: If validation fails
        """
        required_keys = ["version", "snapshot", "computed_at", "hierarchy"]
        for key in required_keys:
            if key not in artifact:
                raise ValueError(f"Missing required key in artifact: {key}")

        # Validate snapshot structure
        snapshot = artifact["snapshot"]
        required_snapshot_keys = ["date", "path", "size", "file_count"]
        for key in required_snapshot_keys:
            if key not in snapshot:
                raise ValueError(f"Missing required key in snapshot: {key}")

        # Validate hierarchy structure
        hierarchy = artifact["hierarchy"]
        required_hierarchy_keys = ["root_node_id", "nodes", "metadata"]
        for key in required_hierarchy_keys:
            if key not in hierarchy:
                raise ValueError(f"Missing required key in hierarchy: {key}")

        logger.debug("Artifact validation passed")

    def list_snapshots(self) -> list[str]:
        """
        List all available snapshot dates.

        Returns:
            List of snapshot date strings (YYYY-MM-DD)
        """
        if not self.base_dir.exists():
            return []

        snapshots = []
        for item in self.base_dir.iterdir():
            if item.is_dir() and self._is_valid_date_format(item.name):
                snapshots.append(item.name)

        return sorted(snapshots)

    def _is_valid_date_format(self, date_str: str) -> bool:
        """Check if string is a valid date format (YYYY-MM-DD)."""
        try:
            date.fromisoformat(date_str)
            return True
        except ValueError:
            return False

    def get_artifact_stats(self, snapshot_date: date) -> Optional[Dict[str, Any]]:
        """
        Get statistics about a voronoi artifact.

        Args:
            snapshot_date: The snapshot date

        Returns:
            Dict with stats or None if artifact doesn't exist
        """
        artifact_path = self._get_voronoi_artifact_path(snapshot_date)

        if not artifact_path.exists():
            return None

        stats = {
            "path": str(artifact_path),
            "exists": True,
            "size_bytes": artifact_path.stat().st_size,
            "modified_time": artifact_path.stat().st_mtime,
        }

        # Try to load and extract stats
        artifact = self.load_voronoi_artifact(snapshot_date)
        if artifact:
            stats["version"] = artifact.get("version")
            stats["computed_at"] = artifact.get("computed_at")
            if "hierarchy" in artifact and "metadata" in artifact["hierarchy"]:
                stats.update(artifact["hierarchy"]["metadata"])

        return stats
