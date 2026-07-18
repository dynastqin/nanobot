"""Hook that drains the turn cleanup registry at turn end."""

from __future__ import annotations

from loguru import logger

from nanobot.agent.cleanup import drain_cleanup
from nanobot.agent.hook import AgentHook, TurnEndHookContext


class CleanupHook(AgentHook):
    """Drains the per-turn cleanup registry in on_turn_end."""

    def __init__(self) -> None:
        super().__init__(reraise=False)

    async def on_turn_end(self, context: TurnEndHookContext) -> None:
        logger.info(
            "[CleanupHook] Draining turn cleanup registry for session {} (stop_reason={})",
            context.session_key,
            context.stop_reason,
        )
        await drain_cleanup()
