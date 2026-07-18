"""List subagents tool — query running subagent status."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.context import current_request_session_key
from nanobot.agent.tools.schema import tool_parameters_schema

if TYPE_CHECKING:
    from nanobot.agent.subagent import SubagentManager


@tool_parameters(tool_parameters_schema())
class ListSubagentsTool(Tool):
    """List running subagents for the current session."""

    _scopes = {"core", "subagent"}

    def __init__(self, manager: "SubagentManager") -> None:
        self._manager = manager

    @classmethod
    def create(cls, ctx: Any) -> Tool:
        return cls(manager=ctx.subagent_manager)

    @property
    def name(self) -> str:
        return "list_subagents"

    @property
    def description(self) -> str:
        return (
            "List running subagents for the current session, including task_id, "
            "label, phase, iteration, and elapsed time. Use this to check whether "
            "a subagent is still running before spawning a duplicate."
        )

    @property
    def read_only(self) -> bool:
        return True

    async def execute(self, **kwargs: Any) -> str:
        try:
            session_key = current_request_session_key()
            subagents = self._manager.list_running(session_key)
            if not subagents:
                return "No running subagents."
            now = time.monotonic()
            lines = []
            for s in subagents:
                elapsed = now - s.started_at
                error_note = f" | error: {s.error}" if s.error else ""
                lines.append(
                    f"{s.task_id} | {s.label} | phase={s.phase} "
                    f"| iteration={s.iteration} | elapsed={elapsed:.1f}s{error_note}"
                )
            return "\n".join(lines)
        except Exception as exc:
            return f"Error listing subagents: {exc}"
