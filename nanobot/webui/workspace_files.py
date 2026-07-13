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
    allowed_name: str | None = None,
    shares_map: dict[str, dict[str, Any]] | None = None,
    project_path: Path | None = None,
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
                if depth == 0 and allowed_name and name != allowed_name:
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
                    subtree = _build_tree(
                        Path(entry.path), depth + 1, counter,
                        shares_map=shares_map, project_path=project_path,
                    )
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
                    _attach_share(node, shares_map, project_path)
                    children.append(node)
    except PermissionError:
        return None
    except OSError:
        return None

    return {"name": root.name or str(root), "type": "directory", "path": str(root), "children": children}


def _attach_share(
    node: dict[str, Any],
    shares_map: dict[str, dict[str, Any]] | None,
    project_path: Path | None,
) -> None:
    """Attach share info to *node* if a persisted share exists for this file."""
    if not shares_map or not project_path:
        return
    try:
        rel = Path(node["path"]).resolve().relative_to(project_path.resolve())
        rel_str = rel.as_posix()
    except (OSError, ValueError):
        return
    share = shares_map.get(rel_str)
    if share:
        node["share"] = share


def list_workspace_files(
    scope: WorkspaceScope,
    subpath: str = ".",
    session_key: str | None = None,
) -> dict[str, Any]:
    """Return a recursive file tree rooted at *subpath* inside *scope*.

    When *subpath* is ``"."`` (default) and *session_key* is provided, the
    tree is rooted at ``outputs/`` and only the session's own subdirectory
    is listed.

    Raises :class:`WebUIWorkspaceFilesError` on invalid input or boundary
    violations.
    """
    cleaned = (subpath or ".").strip()
    if not cleaned:
        cleaned = "."

    session_subdir: str | None = None
    if cleaned == "." and session_key:
        outputs_dir = outputs_dir_for_session(session_key)
        session_subdir = outputs_dir.split("/", 1)[1] if "/" in outputs_dir else outputs_dir
        cleaned = "outputs"

    try:
        resolved = resolve_allowed_path(
            cleaned,
            workspace=scope.project_path,
            allowed_root=scope.project_path,
            strict=False,
        )
    except WorkspaceBoundaryError as e:
        raise WebUIWorkspaceFilesError(403, str(e)) from e
    except OSError as e:
        raise WebUIWorkspaceFilesError(400, "invalid path") from e

    if not resolved.exists():
        return {
            "path": str(resolved),
            "display_path": _display_path(resolved, scope.project_path),
            "tree": {"name": resolved.name or str(resolved), "type": "directory", "children": []},
        }

    if not resolved.is_dir():
        raise WebUIWorkspaceFilesError(400, "path is not a directory")

    counter = [0]
    shares_map: dict[str, dict[str, Any]] | None = None
    if session_key:
        from nanobot.utils.helpers import safe_filename as _safe_filename

        try:
            from nanobot.webui.artifact_share import load_artifact_shares

            session_outputs_dir = (
                scope.project_path / "outputs" / _safe_filename(session_key)
            )
            shares_map = load_artifact_shares(session_outputs_dir)
        except (OSError, ImportError):
            pass

    tree = _build_tree(
        resolved, 0, counter, allowed_name=session_subdir,
        shares_map=shares_map, project_path=scope.project_path,
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
