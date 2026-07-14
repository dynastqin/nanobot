"""Token-based artifact share links for the WebUI.

Generates short random tokens that map to workspace artifact files.
Token→file mappings and share metadata are stored in ``.shares.json`` inside
the session's outputs directory.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import re
import secrets
import time
from pathlib import Path
from typing import Any

from websockets.http11 import Request as WsRequest
from websockets.http11 import Response

from nanobot.security.workspace_policy import WorkspaceBoundaryError, resolve_allowed_path
from nanobot.webui.http_utils import case_insensitive_header, http_error, http_response
from nanobot.webui.media_api import _parse_single_byte_range

_logger = logging.getLogger(__name__)

# MIME types allowed for inline display. Anything outside this set is
# degraded to application/octet-stream so the browser downloads instead.
ARTIFACT_INLINE_MIMES: frozenset[str] = frozenset({
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
    "text/plain",
    "text/html",
    "text/css",
    "text/javascript",
    "text/csv",
    "text/markdown",
    "text/xml",
    "text/yaml",
    "application/json",
    "application/pdf",
    "application/xml",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
})

ALLOWED_EXPIRES_IN: tuple[int, ...] = (0, 86400, 604800)

# 12 random bytes → 24 hex chars, 96 bits of entropy — unenumable
_TOKEN_BYTES = 12
_TOKEN_RE = re.compile(r"^[a-f0-9]{1,48}$")

_SVG_ARTIFACT_HEADERS: tuple[tuple[str, str], ...] = (
    ("Content-Security-Policy",
     "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"),
)

_HTML_ARTIFACT_HEADERS: tuple[tuple[str, str], ...] = (
    ("Content-Security-Policy",
     "sandbox; default-src 'self' 'unsafe-inline' data: blob:"),
)


# ---------------------------------------------------------------------------
# Share persistence (.shares.json)
# ---------------------------------------------------------------------------

def _shares_file(outputs_dir: Path) -> Path:
    return outputs_dir / ".shares.json"


def load_artifact_shares(outputs_dir: Path) -> dict[str, dict[str, Any]]:
    """Load all shares keyed by relative file path."""
    path = _shares_file(outputs_dir)
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, dict)}


def _save_artifact_shares(outputs_dir: Path, shares: dict[str, dict[str, Any]]) -> None:
    _shares_file(outputs_dir).write_text(
        json.dumps(shares, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _find_share_by_token(
    shares: dict[str, dict[str, Any]], token: str
) -> dict[str, Any] | None:
    """Find a share entry by its token."""
    for entry in shares.values():
        if isinstance(entry, dict) and entry.get("token") == token:
            return entry
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_artifact_token(
    abs_path: Path,
    *,
    workspace_path: Path,
    outputs_dir: Path,
    expires_at: int = 0,
    expires_in: int = 0,
    filename: str = "",
) -> str | None:
    """Create a short token that maps to *abs_path* and return the URL path.

    Returns ``/api/artifacts/share?t=<token>`` or ``None`` if the path is
    outside the workspace.
    """
    try:
        rel = abs_path.resolve().relative_to(workspace_path.resolve())
    except (OSError, ValueError):
        return None

    token = secrets.token_hex(_TOKEN_BYTES)
    url = f"/api/artifacts/share?t={token}"

    shares = load_artifact_shares(outputs_dir)
    shares[rel.as_posix()] = {
        "token": token,
        "url": url,
        "expires_at": expires_at,
        "expires_in": expires_in,
        "filename": filename,
    }
    _save_artifact_shares(outputs_dir, shares)
    return url


def serve_artifact_token(
    token: str,
    *,
    workspace_path: Path,
    outputs_dir: Path,
    request: WsRequest | None = None,
    view_source: bool = False,
) -> Response:
    """Serve the file mapped by *token*.

    Returns the file content with appropriate Content-Type and security
    headers, or an error response if the token is unknown, expired, or
    points outside the workspace.

    For markdown files, returns a self-contained HTML page with
    source/preview toggle unless *view_source* is True.
    """
    if not _TOKEN_RE.fullmatch(token):
        return http_error(400, "invalid token")

    shares = load_artifact_shares(outputs_dir)
    entry = _find_share_by_token(shares, token)
    if entry is None:
        return http_error(404, "not found")

    rel_path = entry.get("path") or ""
    # Fallback: derive path from the shares key that matches this token
    if not rel_path:
        for key, val in shares.items():
            if val.get("token") == token:
                rel_path = key
                break

    expires_at = entry.get("expires_at", 0)
    filename = entry.get("filename", "")

    if not isinstance(rel_path, str) or not rel_path:
        return http_error(400, "invalid token data")

    _logger.info(
        "artifact_serve token=%s outputs_dir=%s expires_at=%s rel_path=%s",
        token, str(outputs_dir), expires_at, rel_path,
    )

    if isinstance(expires_at, (int, float)) and expires_at > 0:
        now = time.time()
        _logger.info(
            "artifact_serve token=%s expires_at=%d now=%d expired=%s",
            token, expires_at, int(now), "yes" if now > expires_at else "no",
        )
        if now > expires_at:
            return http_error(410, "link expired")

    try:
        candidate = resolve_allowed_path(
            rel_path,
            workspace=workspace_path,
            allowed_root=workspace_path,
            strict=True,
        )
    except FileNotFoundError:
        return http_error(404, "file not found")
    except WorkspaceBoundaryError:
        return http_error(403, "path outside workspace")
    except OSError:
        return http_error(400, "invalid path")

    if not candidate.is_file():
        return http_error(404, "file not found")

    mime, _ = mimetypes.guess_type(filename or candidate.name)
    if not mime or mime not in ARTIFACT_INLINE_MIMES:
        mime = "application/octet-stream"
    elif mime.startswith("text/"):
        mime = f"{mime}; charset=utf-8"

    common_headers: list[tuple[str, str]] = [
        ("Accept-Ranges", "bytes"),
        ("Cache-Control", "private, max-age=60"),
        ("X-Content-Type-Options", "nosniff"),
    ]

    if mime == "image/svg+xml":
        common_headers.extend(_SVG_ARTIFACT_HEADERS)
    elif mime == "text/html":
        common_headers.extend(_HTML_ARTIFACT_HEADERS)

    # Serve markdown files as a rendered HTML page with source/preview toggle
    if mime.startswith("text/markdown") and not view_source:
        try:
            md_content = candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return http_error(500, "read error")
        html_body = _render_markdown_artifact_page(
            md_content, filename or candidate.name
        )
        return http_response(
            html_body.encode("utf-8"),
            content_type="text/html; charset=utf-8",
            extra_headers=[
                ("Cache-Control", "private, max-age=60"),
                ("X-Content-Type-Options", "nosniff"),
            ],
        )

    try:
        size = candidate.stat().st_size
    except OSError:
        return http_error(500, "read error")

    range_header = ""
    if request is not None:
        range_header = case_insensitive_header(request.headers, "Range")

    if range_header:
        try:
            start, end = _parse_single_byte_range(range_header, size)
        except ValueError:
            return http_response(
                b"range not satisfiable",
                status=416,
                extra_headers=[
                    ("Accept-Ranges", "bytes"),
                    ("Content-Range", f"bytes */{size}"),
                    ("X-Content-Type-Options", "nosniff"),
                ],
            )
        try:
            length = end - start + 1
            with candidate.open("rb") as fh:
                fh.seek(start)
                body = fh.read(length)
        except OSError:
            return http_error(500, "read error")
        return http_response(
            body,
            status=206,
            content_type=mime,
            extra_headers=[*common_headers, ("Content-Range", f"bytes {start}-{end}/{size}")],
        )

    try:
        body = candidate.read_bytes()
    except OSError:
        return http_error(500, "read error")
    return http_response(body, content_type=mime, extra_headers=common_headers)


_ARTIFACT_MD_TEMPLATE: str | None = None


def _get_artifact_md_template() -> str:
    """Load the markdown artifact page template, cached after first read."""
    global _ARTIFACT_MD_TEMPLATE
    if _ARTIFACT_MD_TEMPLATE is None:
        from pathlib import Path as _Path
        template_path = _Path(__file__).resolve().parents[1] / "templates" / "artifact_markdown_page.html"
        _ARTIFACT_MD_TEMPLATE = template_path.read_text(encoding="utf-8")
    return _ARTIFACT_MD_TEMPLATE


def _render_markdown_artifact_page(content: str, filename: str) -> str:
    """Generate a self-contained HTML page that renders *content* as markdown.

    The page includes a toolbar with source/preview toggle and uses marked.js
    from CDN for rendering. Default view is the rendered preview.
    """
    import html as _html
    from string import Template

    tpl = Template(_get_artifact_md_template())
    return tpl.substitute(
        title=_html.escape(filename or "Shared Artifact"),
        filename=_html.escape(filename or "artifact.md"),
        content_json=json.dumps(content),
    )


def validate_expires_in(expires_in: int) -> int | None:
    """Return the validated *expires_in* value or None if disallowed."""
    return expires_in if expires_in in ALLOWED_EXPIRES_IN else None
