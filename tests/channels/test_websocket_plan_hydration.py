"""Test that plan state is pushed to client after WebSocket reconnection (page refresh).

This verifies the fix for the bug where the todos progress card disappears after
page refresh, only to reappear later when the plan tool is called again.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock
from pathlib import Path

from nanobot.channels.websocket import WebSocketChannel
from nanobot.agent.tools.plan import PlanTool


@pytest.fixture
def mock_gateway(tmp_path):
    """Create a mock gateway with necessary services."""
    gateway = MagicMock()
    gateway.session_manager = MagicMock()
    gateway.session_manager.read_session_file.return_value = {}

    # Mock workspaces controller
    mock_workspaces = MagicMock()
    mock_scope = MagicMock()
    mock_scope.project_path = tmp_path
    mock_workspaces.scope_for_session_key.return_value = mock_scope
    gateway.workspaces = mock_workspaces

    # Mock other required services
    gateway.http = MagicMock()
    gateway.tokens = MagicMock()
    gateway.media = MagicMock()
    gateway.transcripts = MagicMock()

    return gateway


@pytest.fixture
def websocket_channel(mock_gateway):
    """Create a WebSocketChannel with mocked dependencies."""
    config = MagicMock()
    config.enabled = True
    config.host = "127.0.0.1"
    config.port = 8765
    config.path = "/ws"
    config.token = ""
    config.websocket_requires_token = False
    config.ssl_certfile = ""
    config.ssl_keyfile = ""
    config.unix_socket_path = ""
    config.allow_from = []
    config.deny_from = []
    config.client_id_max_length = 128
    config.client_id_log_level = "info"
    config.max_message_bytes = 0
    config.heartbeat_interval = 0
    config.heartbeat_timeout = 0
    config.token_issue_path = ""
    config.token_issue_secret = ""

    bus = MagicMock()
    channel = WebSocketChannel(config, bus, gateway=mock_gateway)
    return channel


async def test_plan_state_pushed_on_subscribe(websocket_channel, tmp_path):
    """Verify that active plan state is pushed when a client subscribes to a chat."""
    chat_id = "test-chat-123"
    session_key = f"websocket:{chat_id}"

    # Create a plan using the PlanTool
    plan_tool = PlanTool(workspace=str(tmp_path))
    from nanobot.agent.tools.context import RequestContext
    from nanobot.agent.tools.plan import _plan_session_key

    ctx = RequestContext(channel="websocket", chat_id=chat_id, session_key=session_key)
    plan_tool.set_context(ctx)
    _plan_session_key.set(session_key)

    await plan_tool.execute(
        action="create",
        title="Test Plan",
        goal="Fix the bug",
        steps=[
            {"text": "Step 1", "status": "pending"},
            {"text": "Step 2", "status": "active"},
            {"text": "Step 3", "status": "done"},
        ],
    )

    # Mock send_plan_state to capture what's sent
    websocket_channel.send_plan_state = AsyncMock()

    # Simulate a client subscribing (which triggers hydration)
    await websocket_channel._maybe_push_active_plan_state(chat_id)

    # Verify that send_plan_state was called with the plan data
    websocket_channel.send_plan_state.assert_called_once()
    call_args = websocket_channel.send_plan_state.call_args
    assert call_args[0][0] == chat_id
    plan_data = call_args[0][1]
    assert plan_data is not None
    assert plan_data["title"] == "Test Plan"
    assert plan_data["goal"] == "Fix the bug"
    assert len(plan_data["steps"]) == 3
    assert plan_data["steps"][0]["status"] == "pending"
    assert plan_data["steps"][1]["status"] == "active"
    assert plan_data["steps"][2]["status"] == "done"


async def test_no_plan_state_pushed_when_no_plan(websocket_channel):
    """Verify that nothing is pushed when there's no active plan."""
    chat_id = "test-chat-456"

    # Mock send_plan_state
    websocket_channel.send_plan_state = AsyncMock()

    # Simulate a client subscribing
    await websocket_channel._maybe_push_active_plan_state(chat_id)

    # Verify that send_plan_state was NOT called
    websocket_channel.send_plan_state.assert_not_called()


async def test_no_plan_state_pushed_for_completed_plan(websocket_channel, tmp_path):
    """Verify that completed plans are not pushed."""
    chat_id = "test-chat-789"
    session_key = f"websocket:{chat_id}"

    # Create and complete a plan
    plan_tool = PlanTool(workspace=str(tmp_path))
    from nanobot.agent.tools.context import RequestContext
    from nanobot.agent.tools.plan import _plan_session_key

    ctx = RequestContext(channel="websocket", chat_id=chat_id, session_key=session_key)
    plan_tool.set_context(ctx)
    _plan_session_key.set(session_key)

    await plan_tool.execute(action="create", title="Plan to complete")
    await plan_tool.execute(action="done")

    # Mock send_plan_state
    websocket_channel.send_plan_state = AsyncMock()

    # Simulate a client subscribing
    await websocket_channel._maybe_push_active_plan_state(chat_id)

    # Verify that send_plan_state was NOT called (completed plans are not active)
    websocket_channel.send_plan_state.assert_not_called()
