"""Turn-scoped cleanup registry for side-effect resources."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token
from typing import Awaitable, Callable

from loguru import logger

CleanupFn = Callable[[], Awaitable[None]]


class TurnCleanupRegistry:
    __slots__ = ("_callbacks",)

    def __init__(self) -> None:
        self._callbacks: list[CleanupFn] = []

    def register(self, fn: CleanupFn) -> None:
        self._callbacks.append(fn)

    async def drain(self) -> None:
        for fn in reversed(self._callbacks):  # LIFO
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Turn cleanup callback failed, continuing")
        self._callbacks.clear()


_current_cleanup_registry: ContextVar[TurnCleanupRegistry | None] = ContextVar(
    "nanobot_turn_cleanup_registry", default=None
)


def bind_cleanup_registry() -> Token[TurnCleanupRegistry | None]:
    return _current_cleanup_registry.set(TurnCleanupRegistry())


def reset_cleanup_registry(token: Token[TurnCleanupRegistry | None]) -> None:
    _current_cleanup_registry.reset(token)


def register_cleanup(fn: CleanupFn) -> None:
    """Register an async cleanup callback for the current turn.

    Safe to call when no registry is bound (no-op).
    """
    registry = _current_cleanup_registry.get()
    if registry is not None:
        registry.register(fn)


async def drain_cleanup() -> None:
    """Drain the current turn's cleanup registry."""
    registry = _current_cleanup_registry.get()
    if registry is not None:
        await registry.drain()
