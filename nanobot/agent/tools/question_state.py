"""Batch question state management for the ``ask_user_question`` tool.

A module-level singleton tracks in-flight question batches keyed by
``question_id``. The tool blocks on an asyncio.Event; when the frontend
submits answers via ``answer_question``, the WS channel resolves the batch
and unblocks the tool.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field


@dataclass
class QuestionBatch:
    question_id: str
    session_key: str
    questions: list[dict]
    answer_event: asyncio.Event
    answers: dict[str, str] | None = None
    created_at: float = field(default_factory=time.time)


class QuestionStateManager:
    def __init__(self) -> None:
        self._batches: dict[str, QuestionBatch] = {}
        self._by_session: dict[str, set[str]] = {}

    async def add_batch(
        self, question_id: str, session_key: str, questions: list[dict]
    ) -> QuestionBatch:
        batch = QuestionBatch(
            question_id=question_id,
            session_key=session_key,
            questions=questions,
            answer_event=asyncio.Event(),
        )
        self._batches[question_id] = batch
        self._by_session.setdefault(session_key, set()).add(question_id)
        return batch

    async def await_answer(self, question_id: str) -> dict[str, str]:
        batch = self._batches.get(question_id)
        if batch is None:
            raise ValueError(f"Unknown question_id: {question_id}")
        await batch.answer_event.wait()
        return batch.answers or {}

    async def resolve(self, question_id: str, answers: dict[str, str]) -> bool:
        batch = self._batches.get(question_id)
        if batch is None:
            return False
        batch.answers = answers
        batch.answer_event.set()
        return True

    async def cleanup_session(self, session_key: str) -> None:
        batch_ids = self._by_session.pop(session_key, set())
        for qid in batch_ids:
            batch = self._batches.pop(qid, None)
            if batch is not None:
                batch.answer_event.set()  # unblock any waiter


_question_state_manager: QuestionStateManager | None = None


def get_question_state_manager() -> QuestionStateManager:
    global _question_state_manager
    if _question_state_manager is None:
        _question_state_manager = QuestionStateManager()
    return _question_state_manager
