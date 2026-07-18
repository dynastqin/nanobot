"""Persistent gateway signing secret.

The secret survives gateway restarts so that signed media URLs (and other
HMAC-signed payloads) remain valid across process lifetimes.
"""

from __future__ import annotations

import base64
import os
import secrets

from nanobot.config.paths import get_data_dir

_SECRET_FILE = "gateway_secret"
_SECRET_BYTES = 32


def load_or_create_gateway_secret() -> bytes:
    """Load the persistent signing secret from disk, or create it on first run."""
    secret_path = get_data_dir() / _SECRET_FILE
    try:
        raw = secret_path.read_bytes()
        return base64.b64decode(raw)
    except (FileNotFoundError, ValueError):
        pass

    key = secrets.token_bytes(_SECRET_BYTES)
    tmp = secret_path.with_suffix(".tmp")
    tmp.write_bytes(base64.b64encode(key))
    os.chmod(tmp, 0o600)
    tmp.replace(secret_path)
    return key
