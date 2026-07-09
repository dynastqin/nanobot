from __future__ import annotations

from pathlib import Path

import pytest

from nanobot.security.workspace_access import build_workspace_scope
from nanobot.webui.workspace_files import list_workspace_files


def _scope(tmp_path: Path):
    return build_workspace_scope(tmp_path, "full")


def _names(tree: dict) -> list[str]:
    return [node["name"] for node in tree.get("children", [])]


@pytest.fixture()
def workspace_with_outputs(tmp_path: Path) -> Path:
    """Build a workspace with outputs dirs for two sessions."""
    (tmp_path / "outputs" / "websocket_sessionA").mkdir(parents=True)
    (tmp_path / "outputs" / "websocket_sessionA" / "a.txt").write_text("a", encoding="utf-8")
    (tmp_path / "outputs" / "websocket_sessionB").mkdir(parents=True)
    (tmp_path / "outputs" / "websocket_sessionB" / "b.txt").write_text("b", encoding="utf-8")
    return tmp_path


def test_root_shows_outputs_with_only_own_session_dir(workspace_with_outputs: Path):
    """Root is outputs/, children filtered to only the caller's session subdirectory."""
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:sessionA")

    # Root name should be "outputs"
    assert payload["tree"]["name"] == "outputs"
    # Children: only websocket_sessionA, not sessionB
    assert _names(payload["tree"]) == ["websocket_sessionA"]


def test_session_b_sees_only_own_dir(workspace_with_outputs: Path):
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:sessionB")

    assert payload["tree"]["name"] == "outputs"
    assert _names(payload["tree"]) == ["websocket_sessionB"]


def test_session_dir_contains_files(workspace_with_outputs: Path):
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:sessionA")

    session_dir = payload["tree"]["children"][0]
    assert session_dir["name"] == "websocket_sessionA"
    assert _names(session_dir) == ["a.txt"]


def test_empty_for_nonexistent_session(workspace_with_outputs: Path):
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:noSuch")

    assert payload["tree"]["name"] == "outputs"
    assert payload["tree"]["children"] == []


def test_subpath_navigates_deep(workspace_with_outputs: Path):
    (workspace_with_outputs / "outputs" / "websocket_sessionA" / "sub").mkdir()
    (workspace_with_outputs / "outputs" / "websocket_sessionA" / "sub" / "deep.txt").write_text(
        "deep", encoding="utf-8"
    )

    payload = list_workspace_files(
        _scope(workspace_with_outputs),
        subpath="outputs/websocket_sessionA/sub",
        session_key="websocket:sessionA",
    )

    assert _names(payload["tree"]) == ["deep.txt"]
