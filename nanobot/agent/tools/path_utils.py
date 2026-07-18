"""Shared path helpers for workspace-scoped tools."""

from pathlib import Path

from nanobot.config.paths import get_clouddisk_dir, get_media_dir
from nanobot.security.workspace_policy import (
    is_path_within,
    resolve_allowed_path,
)


def is_under(path: Path, directory: Path) -> bool:
    """Return True when path resolves under directory."""
    return is_path_within(path, directory)


def resolve_workspace_path(
    path: str,
    workspace: Path | None = None,
    allowed_dir: Path | None = None,
    extra_allowed_dirs: list[Path] | None = None,
    extra_allowed_files: list[Path] | None = None,
    include_media_dir: bool = True,
) -> Path:
    """Resolve path against workspace and enforce allowed directory containment."""
    media_roots = [get_media_dir()] if include_media_dir else []
    extra_roots = [*media_roots, *(extra_allowed_dirs or [])] if allowed_dir else None
    return resolve_allowed_path(
        path,
        workspace=workspace,
        allowed_root=allowed_dir,
        extra_allowed_roots=extra_roots,
        extra_allowed_files=extra_allowed_files,
    )


def resolve_clouddisk_path(path: str, clouddisk_root: Path) -> Path:
    """Resolve *path* relative to *clouddisk_root* with boundary enforcement."""
    cleaned = path.lstrip("/")
    resolved = (clouddisk_root / cleaned).resolve()
    try:
        resolved.relative_to(clouddisk_root.resolve())
    except ValueError:
        raise PermissionError(f"Path {path!r} is outside clouddisk root")
    return resolved
