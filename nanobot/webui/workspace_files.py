"""Workspace file tree builder for the WebUI Session Files tab.

Builds a recursive JSON tree of visible workspace files, respecting
workspace boundaries and skipping hidden/system entries.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from nanobot.security.workspace_access import WorkspaceScope
from nanobot.security.workspace_policy import WorkspaceBoundaryError, resolve_allowed_path
from nanobot.utils.helpers import outputs_dir_for_session

MAX_DEPTH = 256
MAX_ENTRIES = 10_000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class WebUIWorkspaceFilesError(ValueError):
    """Raised when workspace files cannot be listed."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _build_tree(
    root: Path,
    depth: int,
    counter: list[int],
    allowed_outputs: str | None = None,
    is_workspace_root: bool = False,
) -> dict[str, Any] | None:
    """Recursively build a file tree node. Returns None if this subtree is empty."""
    if depth > MAX_DEPTH or counter[0] >= MAX_ENTRIES:
        return None

    children: list[dict[str, Any]] = []
    try:
        with os.scandir(root) as entries:
            for entry in sorted(entries, key=lambda e: (not e.is_dir(), e.name.lower())):
                name = entry.name
                if name.startswith("."):
                    continue
                if is_workspace_root and depth == 0:
                    allowed = {"skills"}
                    if allowed_outputs:
                        allowed.add(allowed_outputs)
                    if name not in allowed:
                        continue

                counter[0] += 1
                if counter[0] > MAX_ENTRIES:
                    break

                rel_path = entry.path
                node: dict[str, Any] = {
                    "name": name,
                    "path": rel_path,
                    "type": "directory" if entry.is_dir() else "file",
                }

                if entry.is_dir():
                    subtree = _build_tree(Path(entry.path), depth + 1, counter)
                    if subtree is not None and subtree.get("children"):
                        node["children"] = subtree["children"]
                    elif subtree is not None:
                        # empty directory, skip children key
                        pass
                    else:
                        # directory was skipped entirely
                        pass
                    children.append(node)
                else:
                    try:
                        node["size"] = entry.stat().st_size
                    except OSError:
                        node["size"] = 0
                    children.append(node)
    except PermissionError:
        return None
    except OSError:
        return None

    return {"name": root.name or str(root), "type": "directory", "path": str(root), "children": children}


def list_workspace_files(
    scope: WorkspaceScope,
    subpath: str = ".",
    session_key: str | None = None,
) -> dict[str, Any]:
    """Return a recursive file tree rooted at *subpath* inside *scope*.

    At the workspace root (depth 0), only ``skills/`` and the caller's
    per-session ``outputs_<session_id>/`` directory are listed. Other sessions'
    outputs and the legacy ``outputs/`` directory are hidden.

    Raises :class:`WebUIWorkspaceFilesError` on invalid input or boundary
    violations.
    """
    cleaned = (subpath or ".").strip()
    if not cleaned:
        cleaned = "."

    try:
        resolved = resolve_allowed_path(
            cleaned,
            workspace=scope.project_path,
            allowed_root=scope.project_path,
            strict=True,
        )
    except FileNotFoundError as e:
        raise WebUIWorkspaceFilesError(404, "path not found") from e
    except WorkspaceBoundaryError as e:
        raise WebUIWorkspaceFilesError(403, str(e)) from e
    except OSError as e:
        raise WebUIWorkspaceFilesError(400, "invalid path") from e

    if not resolved.is_dir():
        raise WebUIWorkspaceFilesError(400, "path is not a directory")

    counter = [0]
    tree = _build_tree(
        resolved,
        0,
        counter,
        allowed_outputs=outputs_dir_for_session(session_key),
        is_workspace_root=resolved == scope.project_path,
    )
    if tree is None:
        return {
            "path": str(resolved),
            "display_path": _display_path(resolved, scope.project_path),
            "tree": {"name": resolved.name or str(resolved), "type": "directory", "children": []},
        }

    result: dict[str, Any] = {
        "path": str(resolved),
        "display_path": _display_path(resolved, scope.project_path),
        "tree": tree,
    }

    import json

    serialized = json.dumps(result, ensure_ascii=False)
    if len(serialized.encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise WebUIWorkspaceFilesError(
            413,
            "file tree exceeds maximum response size",
        )
    return result


def _display_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix() or "."
    except ValueError:
        return path.as_posix()
