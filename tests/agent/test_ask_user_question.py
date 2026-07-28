"""Tests for the ask_user_question tool and QuestionStateManager."""

from __future__ import annotations

import asyncio

import pytest

from nanobot.agent.tools.question_state import QuestionStateManager, get_question_state_manager


class TestQuestionStateManager:
    @pytest.fixture(autouse=True)
    def setup(self) -> None:
        self.manager = QuestionStateManager()

    @pytest.mark.asyncio
    async def test_add_and_resolve(self) -> None:
        qid = "q1"
        questions = [{"id": "q0", "question": "What?", "header": "Q", "options": []}]
        await self.manager.add_batch(qid, "session:1", questions)

        resolved = await self.manager.resolve(qid, {"q0": "answer"})
        assert resolved is True

        answers = await self.manager.await_answer(qid)
        assert answers == {"q0": "answer"}

    @pytest.mark.asyncio
    async def test_resolve_unknown_question(self) -> None:
        resolved = await self.manager.resolve("unknown", {})
        assert resolved is False

    @pytest.mark.asyncio
    async def test_cleanup_session(self) -> None:
        qid = "q3"
        questions = [{"id": "q0", "question": "What?", "header": "Q", "options": []}]
        await self.manager.add_batch(qid, "session:3", questions)

        await self.manager.cleanup_session("session:3")

        # After cleanup, resolve should fail (batch is gone).
        resolved = await self.manager.resolve(qid, {"q0": "x"})
        assert resolved is False

    @pytest.mark.asyncio
    async def test_await_answer_unknown_id(self) -> None:
        with pytest.raises(ValueError, match="Unknown question_id"):
            await self.manager.await_answer("nonexistent")

    @pytest.mark.asyncio
    async def test_cleanup_unblocks_waiter(self) -> None:
        qid = "q4"
        questions = [{"id": "q0", "question": "What?", "header": "Q", "options": []}]
        await self.manager.add_batch(qid, "session:4", questions)

        async def waiter() -> dict:
            return await self.manager.await_answer(qid)

        task = asyncio.create_task(waiter())
        await asyncio.sleep(0.05)

        await self.manager.cleanup_session("session:4")

        answers = await task
        assert answers == {}


class TestGetQuestionStateManager:
    def test_singleton(self) -> None:
        m1 = get_question_state_manager()
        m2 = get_question_state_manager()
        assert m1 is m2
