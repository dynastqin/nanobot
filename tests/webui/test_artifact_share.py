"""Tests for artifact share link signing, verification, and serving."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from nanobot.webui.artifact_share import (
    ALLOWED_EXPIRES_IN,
    sign_artifact_path,
    serve_signed_artifact,
    validate_expires_in,
)
from nanobot.webui.media_api import b64url_decode, b64url_encode


@pytest.fixture()
def secret() -> bytes:
    return secrets.token_bytes(32)


@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    outputs = ws / "outputs" / "test_session"
    outputs.mkdir(parents=True)
    (outputs / "report.md").write_text("# Hello\n\nThis is a test report.", encoding="utf-8")
    (outputs / "data.json").write_text('{"key": "value"}', encoding="utf-8")
    (outputs / "image.png").write_bytes(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x00"
        b"\x00\x02\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return ws


# -- sign_artifact_path -------------------------------------------------------


def test_sign_artifact_path_returns_url(secret: bytes, workspace: Path) -> None:
    path = workspace / "outputs" / "test_session" / "report.md"
    url = sign_artifact_path(path, workspace_path=workspace, secret=secret)
    assert url is not None
    assert url.startswith("/api/artifacts/share?t=")


def test_sign_artifact_path_rejects_outside_workspace(
    secret: bytes, workspace: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")
    url = sign_artifact_path(outside, workspace_path=workspace, secret=secret)
    assert url is None


def test_sign_artifact_path_no_traversal(secret: bytes, workspace: Path) -> None:
    traversal = workspace / ".." / "etc" / "passwd"
    url = sign_artifact_path(traversal, workspace_path=workspace, secret=secret)
    assert url is None


def test_sign_artifact_payload_contains_correct_data(
    secret: bytes, workspace: Path
) -> None:
    path = workspace / "outputs" / "test_session" / "report.md"
    expires_at = int(time.time()) + 3600
    url = sign_artifact_path(
        path,
        workspace_path=workspace,
        secret=secret,
        expires_at=expires_at,
        filename="report.md",
    )
    assert url is not None
    sig, payload = url[len("/api/artifacts/"):].split("/", 1)
    payload_bytes = b64url_decode(payload)
    payload_obj = json.loads(payload_bytes.decode("utf-8"))
    assert payload_obj["p"] == "outputs/test_session/report.md"
    assert payload_obj["e"] == expires_at
    assert payload_obj["n"] == "report.md"


def test_sign_artifact_permanent_when_expires_at_zero(
    secret: bytes, workspace: Path
) -> None:
    path = workspace / "outputs" / "test_session" / "report.md"
    url = sign_artifact_path(path, workspace_path=workspace, secret=secret, expires_at=0)
    assert url is not None
    _, payload = url[len("/api/artifacts/"):].split("/", 1)
    payload_obj = json.loads(b64url_decode(payload).decode("utf-8"))
    assert payload_obj["e"] == 0


# -- serve_signed_artifact ----------------------------------------------------


def _make_signed_url(
    rel_path: str,
    *,
    secret: bytes,
    expires_at: int = 0,
    filename: str = "",
) -> str:
    payload_obj = {"p": rel_path, "e": expires_at}
    if filename:
        payload_obj["n"] = filename
    payload_enc = b64url_encode(json.dumps(payload_obj, separators=(",", ":")).encode("utf-8"))
    mac = hmac.new(secret, payload_enc.encode("ascii"), hashlib.sha256).digest()[:16]
    return f"/api/artifacts/{b64url_encode(mac)}/{payload_enc}"


def test_serve_signed_artifact_returns_file_content(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url("outputs/test_session/report.md", secret=secret)
    _, sig, payload = url.split("/", 2)
    sig, payload = sig, payload
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    assert b"# Hello" in response.body


def test_serve_signed_artifact_invalid_signature(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url("outputs/test_session/report.md", secret=secret)
    _, sig, payload = url.split("/", 2)
    fake_secret = secrets.token_bytes(32)
    response = serve_signed_artifact(
        sig, payload, secret=fake_secret, workspace_path=workspace
    )
    assert response.status_code == 401


def test_serve_signed_artifact_tampered_payload(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url("outputs/test_session/report.md", secret=secret)
    _, sig, payload = url.split("/", 2)
    # Tamper with payload (change path)
    orig = json.loads(b64url_decode(payload).decode("utf-8"))
    orig["p"] = "outputs/test_session/data.json"
    tampered = b64url_encode(json.dumps(orig, separators=(",", ":")).encode("utf-8"))
    response = serve_signed_artifact(
        sig, tampered, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 401


def test_serve_signed_artifact_expired_returns_410(
    secret: bytes, workspace: Path
) -> None:
    past = int(time.time()) - 3600
    url = _make_signed_url(
        "outputs/test_session/report.md", secret=secret, expires_at=past
    )
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 410


def test_serve_signed_artifact_permanent_never_expires(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url(
        "outputs/test_session/report.md", secret=secret, expires_at=0
    )
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200


def test_serve_signed_artifact_path_traversal_rejected(
    secret: bytes, workspace: Path
) -> None:
    secret_path = workspace / ".." / "secret.txt"
    url = _make_signed_url("../secret.txt", secret=secret)
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code in (403, 404)


def test_serve_signed_artifact_nonexistent_file(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url("outputs/test_session/nonexistent.txt", secret=secret)
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 404


def test_serve_signed_artifact_svg_csp_headers(
    secret: bytes, workspace: Path
) -> None:
    outputs = workspace / "outputs" / "test_session"
    (outputs / "icon.svg").write_text('<svg></svg>', encoding="utf-8")
    url = _make_signed_url("outputs/test_session/icon.svg", secret=secret)
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    csp = _get_header(response, "Content-Security-Policy")
    assert csp is not None
    assert "sandbox" in csp


def test_serve_signed_artifact_html_csp_headers(
    secret: bytes, workspace: Path
) -> None:
    outputs = workspace / "outputs" / "test_session"
    (outputs / "page.html").write_text("<html></html>", encoding="utf-8")
    url = _make_signed_url("outputs/test_session/page.html", secret=secret)
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    csp = _get_header(response, "Content-Security-Policy")
    assert csp is not None
    assert "sandbox" in csp


def test_serve_signed_artifact_inline_mime_preserved(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url("outputs/test_session/report.md", secret=secret)
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    content_type = _get_header(response, "Content-Type")
    assert content_type is not None
    assert "text/" in content_type


def test_serve_signed_artifact_disallowed_mime_downgraded(
    secret: bytes, workspace: Path
) -> None:
    outputs = workspace / "outputs" / "test_session"
    (outputs / "malware.exe").write_bytes(b"MZ\x90\x00")
    url = _make_signed_url(
        "outputs/test_session/malware.exe", secret=secret, filename="malware.exe"
    )
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    content_type = _get_header(response, "Content-Type")
    assert content_type == "application/octet-stream"


def test_serve_signed_artifact_nosniff_header(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url("outputs/test_session/report.md", secret=secret)
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    nosniff = _get_header(response, "X-Content-Type-Options")
    assert nosniff == "nosniff"


def test_serve_signed_artifact_content_disposition_inline(
    secret: bytes, workspace: Path
) -> None:
    url = _make_signed_url(
        "outputs/test_session/report.md", secret=secret, filename="report.md"
    )
    _, sig, payload = url.split("/", 2)
    response = serve_signed_artifact(
        sig, payload, secret=secret, workspace_path=workspace
    )
    assert response.status_code == 200
    cd = _get_header(response, "Content-Disposition")
    assert cd is not None
    assert "inline" in cd


# -- validate_expires_in ------------------------------------------------------


def test_validate_expires_in_allows_valid_values() -> None:
    for v in ALLOWED_EXPIRES_IN:
        assert validate_expires_in(v) == v


def test_validate_expires_in_rejects_arbitrary_values() -> None:
    assert validate_expires_in(3600) is None
    assert validate_expires_in(60) is None
    assert validate_expires_in(-1) is None
    assert validate_expires_in(999999) is None


# -- helpers ------------------------------------------------------------------


def _get_header(response, name: str) -> str | None:
    if hasattr(response, "headers"):
        headers = response.headers
        if callable(headers):
            headers = headers()
        if isinstance(headers, dict):
            for k, v in headers.items():
                if k.lower() == name.lower():
                    return v
        elif isinstance(headers, list):
            for k, v in headers:
                if k.lower() == name.lower():
                    return v
    return None
