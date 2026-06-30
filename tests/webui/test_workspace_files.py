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
    """Build a workspace with skills, legacy outputs, and two per-session outputs dirs."""
    (tmp_path / "skills").mkdir()
    (tmp_path / "skills" / "demo.txt").write_text("hi", encoding="utf-8")
    (tmp_path / "outputs").mkdir()  # legacy — should be hidden
    (tmp_path / "outputs" / "old.txt").write_text("legacy", encoding="utf-8")
    (tmp_path / "outputs_websocket_sessionA").mkdir()
    (tmp_path / "outputs_websocket_sessionA" / "a.txt").write_text("a", encoding="utf-8")
    (tmp_path / "outputs_websocket_sessionB").mkdir()
    (tmp_path / "outputs_websocket_sessionB" / "b.txt").write_text("b", encoding="utf-8")
    return tmp_path


def test_list_workspace_files_shows_only_own_outputs_for_session_a(workspace_with_outputs: Path):
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:sessionA")

    assert _names(payload["tree"]) == ["outputs_websocket_sessionA", "skills"]


def test_list_workspace_files_shows_only_own_outputs_for_session_b(workspace_with_outputs: Path):
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:sessionB")

    assert _names(payload["tree"]) == ["outputs_websocket_sessionB", "skills"]


def test_list_workspace_files_hides_legacy_outputs_dir(workspace_with_outputs: Path):
    payload = list_workspace_files(_scope(workspace_with_outputs), session_key="websocket:sessionA")

    names = _names(payload["tree"])
    assert "outputs" not in names
    assert "outputs_websocket_sessionB" not in names


def test_list_workspace_files_subtree_inside_outputs_dir_lists_children(workspace_with_outputs: Path):
    payload = list_workspace_files(
        _scope(workspace_with_outputs),
        subpath="outputs_websocket_sessionA",
        session_key="websocket:sessionA",
    )

    assert _names(payload["tree"]) == ["a.txt"]
