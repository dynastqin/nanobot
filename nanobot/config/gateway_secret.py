"""Persistent gateway-level signing secret.

Provides a durable HMAC signing key that survives gateway restarts, used
by features like artifact share links where signatures must remain valid
across process lifetimes.

Unlike the per-startup media secret (which is fine for inline image URLs
embedded in chat messages), this secret is stored on disk so that signed
URLs remain valid after a gateway restart.
"""

from __future__ import annotations

import base64
import os
import secrets
from pathlib import Path

from nanobot.config.paths import get_data_dir


def _gateway_secret_path() -> Path:
    return get_data_dir() / "gateway_secret"


def load_or_create_gateway_secret() -> bytes:
    """Load the persistent signing secret from disk, or create it on first run.

    Returns 32 random bytes. The secret is stored base64-encoded at
    ``<data_dir>/gateway_secret`` with ``0o600`` permissions.
    """
    secret_path = _gateway_secret_path()
    if secret_path.is_file():
        raw = secret_path.read_text(encoding="ascii").strip()
        try:
            return base64.b64decode(raw)
        except Exception:
            # Corrupt file — regenerate
            pass

    key = secrets.token_bytes(32)
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, base64.b64encode(key) + b"\n")
    finally:
        os.close(fd)
    return key
