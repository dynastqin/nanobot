"""CloudDisk backend: file index, operations, and gateway singleton.

CloudDisk is instance-scoped persistent file storage at ``<instance>/clouddisk/``.
It merges the old ``media/`` directory into a single user-visible file space.
"""

from __future__ import annotations

import json
import mimetypes
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from nanobot.config.paths import ensure_clouddisk_dirs
from nanobot.utils.helpers import ensure_dir


# ---------------------------------------------------------------------------
# Metadata index
# ---------------------------------------------------------------------------


@dataclass
class FileMeta:
    name: str
    size: int
    type: str  # "file" | "directory"
    created_at: str  # ISO 8601
    source_session_id: str | None = None


class CloudDiskIndex:
    """Manages the ``.meta.json`` index at the clouddisk root."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._path = root / ".meta.json"

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            return data.get("files", {}) if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError):
            return {}

    def _save(self, files: dict[str, dict[str, Any]]) -> None:
        payload = json.dumps({"version": 1, "files": files}, ensure_ascii=False, indent=2)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, self._path)

    def all(self) -> dict[str, FileMeta]:
        result: dict[str, FileMeta] = {}
        for rel, entry in self._load().items():
            result[rel] = FileMeta(
                name=entry.get("name", Path(rel).name),
                size=entry.get("size", 0),
                type=entry.get("type", "file"),
                created_at=entry.get("created_at", ""),
                source_session_id=entry.get("source_session_id"),
            )
        return result

    def get(self, rel_path: str) -> FileMeta | None:
        entries = self._load()
        entry = entries.get(rel_path)
        if entry is None:
            return None
        return FileMeta(
            name=entry.get("name", Path(rel_path).name),
            size=entry.get("size", 0),
            type=entry.get("type", "file"),
            created_at=entry.get("created_at", ""),
            source_session_id=entry.get("source_session_id"),
        )

    def add(self, rel_path: str, meta: FileMeta) -> None:
        entries = self._load()
        entries[rel_path] = {
            "name": meta.name,
            "size": meta.size,
            "type": meta.type,
            "created_at": meta.created_at,
            "source_session_id": meta.source_session_id,
        }
        self._save(entries)

    def remove(self, rel_path: str) -> bool:
        entries = self._load()
        if rel_path not in entries:
            return False
        del entries[rel_path]
        self._save(entries)
        return True

    def move(self, from_rel: str, to_rel: str, new_name: str) -> bool:
        entries = self._load()
        entry = entries.pop(from_rel, None)
        if entry is None:
            return False
        entry["name"] = new_name
        entries[to_rel] = entry
        self._save(entries)
        return True

    def used_bytes(self) -> int:
        return sum(e.get("size", 0) for e in self._load().values())

    def file_count(self) -> int:
        return len(self._load())


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------


def resolve_clouddisk_path(path: str, clouddisk_root: Path) -> Path:
    """Resolve *path* relative to *clouddisk_root*, preventing traversal escapes."""
    cleaned = path.lstrip("/")
    resolved = (clouddisk_root / cleaned).resolve()
    try:
        resolved.relative_to(clouddisk_root.resolve())
    except ValueError:
        raise PermissionError(f"Path {path!r} is outside clouddisk root")
    return resolved


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------


class CloudDiskOps:
    """File-system operations on the clouddisk tree."""

    def __init__(self, root: Path, index: CloudDiskIndex,
                 quota_mb: int, max_file_mb: int) -> None:
        self.root = root
        self.index = index
        self.quota_bytes = quota_mb * 1024 * 1024
        self.max_file_bytes = max_file_mb * 1024 * 1024

    # -- list ----------------------------------------------------------------

    def list_dir(self, folder: str = "") -> list[dict[str, Any]]:
        target = self.root if not folder else resolve_clouddisk_path(folder, self.root)
        if not target.is_dir():
            return []
        result: list[dict[str, Any]] = []
        try:
            for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name)):
                if entry.name == ".meta.json" or entry.name.startswith("."):
                    continue
                rel = str(entry.relative_to(self.root))
                meta = self.index.get(rel)
                if entry.is_dir():
                    result.append({
                        "name": entry.name, "path": rel,
                        "type": "directory", "size": 0,
                        "created_at": meta.created_at if meta else "",
                        "source_session_id": None,
                    })
                else:
                    result.append({
                        "name": entry.name, "path": rel,
                        "type": "file",
                        "size": meta.size if meta else entry.stat().st_size,
                        "created_at": meta.created_at if meta else "",
                        "source_session_id": meta.source_session_id if meta else None,
                    })
        except OSError:
            return []
        return result

    # -- upload --------------------------------------------------------------

    def upload(self, folder: str, filename: str, data: bytes,
               source_session_id: str | None = None) -> dict[str, Any]:
        if len(data) > self.max_file_bytes:
            raise ValueError(f"File exceeds max size of {self.max_file_bytes // (1024*1024)}MB")
        ok, msg = self.check_quota(len(data))
        if not ok and "exceeded" in msg:
            raise ValueError(msg)

        target_dir = self.root if not folder else resolve_clouddisk_path(folder, self.root)
        ensure_dir(target_dir)
        dest = target_dir / filename
        dest.write_bytes(data)

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        mime, _ = mimetypes.guess_type(filename)
        rel = str(dest.relative_to(self.root))
        self.index.add(rel, FileMeta(
            name=filename, size=len(data),
            type=mime or "application/octet-stream",
            created_at=now, source_session_id=source_session_id,
        ))
        return {"path": rel, "name": filename, "size": len(data)}

    # -- download ------------------------------------------------------------

    def download(self, path_str: str) -> tuple[bytes, str, str] | None:
        resolved = resolve_clouddisk_path(path_str, self.root)
        if not resolved.is_file():
            return None
        data = resolved.read_bytes()
        mime, _ = mimetypes.guess_type(resolved.name)
        return data, resolved.name, mime or "application/octet-stream"

    # -- delete --------------------------------------------------------------

    def delete(self, path_str: str) -> bool:
        resolved = resolve_clouddisk_path(path_str, self.root)
        if not resolved.exists():
            return False
        if resolved.is_dir():
            shutil.rmtree(resolved)
        else:
            resolved.unlink()
        rel = str(resolved.relative_to(self.root))
        self.index.remove(rel)
        # Also remove any children in the index (for directory deletes)
        for key in list(self.index.all().keys()):
            if key.startswith(rel + "/"):
                self.index.remove(key)
        return True

    # -- move ----------------------------------------------------------------

    def move(self, from_path: str, to_path: str) -> dict[str, Any] | None:
        src = resolve_clouddisk_path(from_path, self.root)
        if not src.exists():
            return None
        dst = resolve_clouddisk_path(to_path, self.root)
        if dst.exists():
            raise FileExistsError(f"Destination {to_path!r} already exists")
        ensure_dir(dst.parent)
        shutil.move(str(src), str(dst))

        from_rel = str(src.relative_to(self.root)) if src.exists() else from_path.lstrip("/")
        # After shutil.move, src no longer exists, so compute from_rel from the original
        from_rel_clean = from_path.lstrip("/")
        to_rel = str(dst.relative_to(self.root))
        self.index.move(from_rel_clean, to_rel, dst.name)
        return {"from": from_rel_clean, "to": to_rel}

    # -- info ----------------------------------------------------------------

    def info(self, path_str: str) -> dict[str, Any] | None:
        resolved = resolve_clouddisk_path(path_str, self.root)
        if not resolved.exists():
            return None
        rel = str(resolved.relative_to(self.root))
        meta = self.index.get(rel)
        stat = resolved.stat()
        return {
            "name": resolved.name,
            "path": rel,
            "type": "directory" if resolved.is_dir() else "file",
            "size": meta.size if meta else stat.st_size,
            "created_at": meta.created_at if meta else "",
            "source_session_id": meta.source_session_id if meta else None,
        }

    # -- quota ---------------------------------------------------------------

    def quota(self) -> dict[str, Any]:
        used = self.index.used_bytes()
        return {
            "used_mb": round(used / (1024 * 1024), 2),
            "quota_mb": self.quota_bytes // (1024 * 1024),
            "file_count": self.index.file_count(),
        }

    def check_quota(self, additional_bytes: int = 0) -> tuple[bool, str]:
        current = self.index.used_bytes()
        if current + additional_bytes > self.quota_bytes:
            return False, f"Quota exceeded: {self.quota_bytes // (1024*1024)}MB limit"
        return True, "ok"


# ---------------------------------------------------------------------------
# Gateway singleton
# ---------------------------------------------------------------------------


class CloudDiskGateway:
    """Injectable clouddisk service, one per gateway process."""

    def __init__(self, root: Path, quota_mb: int, max_file_mb: int) -> None:
        self.root = root
        self.index = CloudDiskIndex(root)
        self.ops = CloudDiskOps(root, self.index, quota_mb, max_file_mb)

    def archive_session_media(self, session_id: str,
                               media_files: list[Path]) -> list[str]:
        """Copy media files into ``聊天归档/<session-id>/`` and update index."""
        target_dir = self.root / "聊天归档" / session_id
        ensure_dir(target_dir)
        archived: list[str] = []
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for f in media_files:
            if not f.is_file():
                continue
            dest = target_dir / f.name
            try:
                shutil.copy2(f, dest)
            except OSError:
                continue
            rel = str(dest.relative_to(self.root))
            mime, _ = mimetypes.guess_type(dest.name)
            self.index.add(rel, FileMeta(
                name=dest.name, size=dest.stat().st_size,
                type=mime or "application/octet-stream",
                created_at=now, source_session_id=session_id,
            ))
            archived.append(rel)
        return archived


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_clouddisk_gateway(quota_mb: int = 10240,
                              max_file_mb: int = 100) -> CloudDiskGateway | None:
    """Create a CloudDiskGateway, or None if clouddisk is disabled."""
    try:
        root = ensure_clouddisk_dirs()
    except Exception:
        return None
    return CloudDiskGateway(root, quota_mb=quota_mb, max_file_mb=max_file_mb)
