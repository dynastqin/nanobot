"""Lightweight skill summaries for the WebUI."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from nanobot.agent.skills import SkillsLoader

MAX_DEPTH = 256
MAX_ENTRIES = 10_000
MAX_FILE_PREVIEW_BYTES = 384 * 1024

_GFM_TABLE_DELIMITER_RE = re.compile(r"^((?:\|[ \t]*[-:]+[ \t]*)+\|)\s*$", re.MULTILINE)


def webui_skills_payload(
    workspace_path: Path,
    *,
    disabled_skills: set[str] | None = None,
) -> dict[str, Any]:
    """Return agent skills without leaking local filesystem paths."""
    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    entries = sorted(
        loader.list_skills(filter_unavailable=False, include_disabled=True),
        key=lambda entry: (entry.get("source") != "workspace", entry["name"]),
    )
    return {"skills": [_skill_payload(loader, entry) for entry in entries]}


def webui_skill_detail_payload(
    workspace_path: Path,
    name: str,
    *,
    disabled_skills: set[str] | None = None,
) -> dict[str, Any] | None:
    """Return a single skill's safe detail payload."""
    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    entries = loader.list_skills(filter_unavailable=False, include_disabled=True)
    entry = next((item for item in entries if item["name"] == name), None)
    if entry is None:
        return None
    return {
        **_skill_payload(loader, entry),
        "requirements": loader.get_skill_requirements(name),
        "raw_markdown": loader.load_skill(name) or "",
    }


def _skill_payload(loader: SkillsLoader, entry: dict[str, str]) -> dict[str, Any]:
    name = entry["name"]
    metadata = loader.get_skill_metadata(name)
    available, unavailable_reason = loader.get_skill_availability(name)
    return {
        "name": name,
        "path": entry.get("path", ""),
        "description": _description(metadata, name),
        "source": entry.get("source", "unknown"),
        "available": available,
        "unavailable_reason": unavailable_reason,
        "disabled": entry.get("disabled", False),
    }


def _description(metadata: dict[str, Any] | None, fallback: str) -> str:
    if metadata is None:
        return fallback
    value = metadata.get("description")
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def webui_skill_toggle(
    workspace_path: Path,
    name: str,
    enable: bool,
    *,
    disabled_skills: set[str] | None = None,
) -> dict[str, Any]:
    """Toggle a workspace skill's enabled/disabled state."""
    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    ok, msg = loader.toggle_skill(name, enable)
    if not ok:
        return {"ok": False, "message": msg}
    return {"ok": True, **webui_skills_payload(workspace_path, disabled_skills=disabled_skills)}


def _resolve_skill_dir(loader: SkillsLoader, name: str) -> Path | None:
    """Return the skill directory for *name*, checking workspace first then builtin."""
    candidate = loader.workspace_skills / name
    if candidate.is_dir() and (candidate / "SKILL.md").exists():
        return candidate
    if loader.builtin_skills:
        candidate = loader.builtin_skills / name
        if candidate.is_dir() and (candidate / "SKILL.md").exists():
            return candidate
    return None


def _build_skill_file_tree(
    root: Path,
    depth: int,
    counter: list[int],
) -> dict[str, Any] | None:
    """Recursively build a file tree node for a skill directory."""
    if depth > MAX_DEPTH or counter[0] >= MAX_ENTRIES:
        return None

    children: list[dict[str, Any]] = []
    try:
        with os.scandir(root) as entries:
            for entry in sorted(entries, key=lambda e: (not e.is_dir(), e.name.lower())):
                name = entry.name
                if name.startswith(".") and name != ".disabled":
                    continue

                counter[0] += 1
                if counter[0] > MAX_ENTRIES:
                    break

                node: dict[str, Any] = {
                    "name": name,
                    "path": str(entry.path),
                    "type": "directory" if entry.is_dir() else "file",
                }

                if entry.is_dir():
                    subtree = _build_skill_file_tree(Path(entry.path), depth + 1, counter)
                    if subtree is not None and subtree.get("children"):
                        node["children"] = subtree["children"]
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

    return {
        "name": root.name,
        "type": "directory",
        "path": str(root),
        "children": children,
    }


def webui_skill_files(
    workspace_path: Path,
    name: str,
    *,
    disabled_skills: set[str] | None = None,
) -> dict[str, Any] | None:
    """Return a file tree for the given skill directory."""
    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    skill_dir = _resolve_skill_dir(loader, name)
    if skill_dir is None:
        return None

    counter = [0]
    tree = _build_skill_file_tree(skill_dir, 0, counter)
    if tree is None:
        tree = {"name": name, "type": "directory", "path": str(skill_dir), "children": []}

    return {
        "path": str(skill_dir),
        "display_path": name,
        "tree": tree,
    }


def _language_for_path(path: Path) -> str:
    name = path.name.lower()
    ext = path.suffix.lower().lstrip(".")
    if name == "dockerfile":
        return "dockerfile"
    return {
        "cjs": "javascript",
        "css": "css",
        "cts": "typescript",
        "html": "html",
        "js": "javascript",
        "json": "json",
        "jsonl": "json",
        "jsx": "jsx",
        "md": "markdown",
        "mdx": "markdown",
        "mjs": "javascript",
        "mts": "typescript",
        "py": "python",
        "pyi": "python",
        "scss": "scss",
        "sh": "bash",
        "toml": "toml",
        "ts": "typescript",
        "tsx": "tsx",
        "yaml": "yaml",
        "yml": "yaml",
    }.get(ext, ext or "text")


def webui_skill_file_preview(
    workspace_path: Path,
    name: str,
    file_path: str,
    *,
    disabled_skills: set[str] | None = None,
) -> dict[str, Any] | None:
    """Return a text preview for a file inside a skill directory."""
    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    skill_dir = _resolve_skill_dir(loader, name)
    if skill_dir is None:
        return None

    resolved = skill_dir / file_path
    try:
        resolved = resolved.resolve()
    except OSError:
        return None

    try:
        resolved.relative_to(skill_dir)
    except ValueError:
        return None

    if not resolved.is_file():
        return None

    try:
        file_size = resolved.stat().st_size
    except OSError:
        file_size = 0

    try:
        with open(resolved, "rb") as f:
            raw = f.read(MAX_FILE_PREVIEW_BYTES + 1)
    except OSError:
        return None

    if b"\0" in raw[:4096]:
        return None

    truncated = len(raw) > MAX_FILE_PREVIEW_BYTES
    preview_bytes = raw[:MAX_FILE_PREVIEW_BYTES]
    try:
        content = preview_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content = preview_bytes.decode("utf-8", errors="replace")

    language = _language_for_path(resolved)
    if language == "markdown":
        content = _GFM_TABLE_DELIMITER_RE.sub(r" \1", content)

    try:
        display_path = str(resolved.relative_to(skill_dir))
    except ValueError:
        display_path = resolved.name

    return {
        "path": str(resolved),
        "display_path": display_path,
        "language": _language_for_path(resolved),
        "content": content,
        "size": file_size,
        "truncated": truncated,
    }


def webui_skill_file_download(
    workspace_path: Path,
    name: str,
    file_path: str,
    *,
    disabled_skills: set[str] | None = None,
) -> tuple[bytes, str, str] | None:
    """Return (content, filename, mime_type) for a file inside a skill directory."""
    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    skill_dir = _resolve_skill_dir(loader, name)
    if skill_dir is None:
        return None

    resolved = skill_dir / file_path
    try:
        resolved = resolved.resolve()
    except OSError:
        return None

    try:
        resolved.relative_to(skill_dir)
    except ValueError:
        return None

    if not resolved.is_file():
        return None

    import mimetypes

    try:
        raw = resolved.read_bytes()
    except OSError:
        return None

    filename = resolved.name
    mime_type, _ = mimetypes.guess_type(filename)
    if not mime_type:
        mime_type = "application/octet-stream"
    return raw, filename, mime_type


def webui_skill_zip_download(
    workspace_path: Path,
    name: str,
    *,
    disabled_skills: set[str] | None = None,
) -> tuple[bytes, str] | None:
    """Return (zip_bytes, filename) for the entire skill directory as a zip archive."""
    import io
    import zipfile

    loader = SkillsLoader(workspace_path, disabled_skills=disabled_skills)
    skill_dir = _resolve_skill_dir(loader, name)
    if skill_dir is None:
        return None

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(skill_dir.rglob("*")):
            if file_path.is_dir():
                continue
            if file_path.name.startswith(".") and file_path.name != ".disabled":
                continue
            try:
                arcname = str(file_path.relative_to(skill_dir))
            except ValueError:
                arcname = file_path.name
            try:
                zf.write(file_path, arcname)
            except OSError:
                continue

    return buf.getvalue(), f"{name}.zip"
