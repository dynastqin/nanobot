"""Ask user questions tool — lets the LLM ask clarifying questions via WebUI."""

from __future__ import annotations

import uuid
from typing import Any

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.context import ToolContext, current_request_context
from nanobot.agent.tools.question_state import get_question_state_manager
from nanobot.bus.events import OUTBOUND_META_AGENT_UI, OutboundMessage

_ASK_USER_QUESTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "description": "1-4 questions to ask the user",
            "minItems": 1,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The complete question to ask the user",
                    },
                    "options": {
                        "type": "array",
                        "description": "2-4 available choices",
                        "minItems": 2,
                        "maxItems": 4,
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {
                                    "type": "string",
                                    "description": "Display text (1-5 words)",
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Explanation of this option",
                                },
                                "recommend": {
                                    "type": "boolean",
                                    "description": "Mark this as the recommended option",
                                },
                            },
                            "required": ["label", "description"],
                        },
                    },
                    "multiSelect": {
                        "type": "boolean",
                        "description": "Allow multiple selections",
                    },
                },
                "required": ["question", "options"],
            },
        },
    },
    "required": ["questions"],
}


@tool_parameters(_ASK_USER_QUESTION_SCHEMA)
class AskUserQuestionTool(Tool):
    name = "ask_user_question"
    # description = "Ask the user clarifying questions. Only works in WebUI; returns an error on other channels."
    description = (
        "Present the user with structured single/multi-choice questions and wait "
        "for answers. Use this for any multi-option interaction: clarifying intent, "
        "interviewing, plan confirmation, branch selection. Renders as clickable UI. "
        "Only works in WebUI; returns an error on other channels."
    )
    exclusive = True
    _scopes = {"core", "subagent"}

    def __init__(self, bus: Any = None) -> None:
        self._manager = get_question_state_manager()
        self._bus = bus

    @classmethod
    def create(cls, ctx: ToolContext) -> AskUserQuestionTool:
        return cls(bus=ctx.bus)

    async def execute(self, questions: list[dict[str, Any]]) -> str:
        req = current_request_context()
        if req is None:
            return (
                "Error: No request context available. "
                "Please ask your questions in plain text instead."
            )
        if req.channel != "websocket":
            return (
                "Error: ask_user_question is only supported in the WebUI. "
                "Please rephrase your questions as plain text and ask them directly "
                "in the chat instead."
            )

        if self._bus is None:
            return "Error: Message bus not available. Cannot ask questions."

        question_id = str(uuid.uuid4())
        session_key = req.session_key or f"{req.channel}:{req.chat_id}"

        # Assign a stable internal id for each question so the frontend can
        # reference them in answers.
        for i, q in enumerate(questions):
            q["id"] = f"q{i}"

        agent_ui = {
            "kind": "ask_user_question",
            "question_id": question_id,
            "questions": questions,
        }

        self._bus.outbound.put_nowait(OutboundMessage(
            channel="websocket",
            chat_id=req.chat_id,
            content="",
            metadata={OUTBOUND_META_AGENT_UI: agent_ui},
        ))

        await self._manager.add_batch(question_id, session_key, questions)
        answers = await self._manager.await_answer(question_id)

        if not answers:
            return "The user did not answer the questions."

        lines = ["User answers:"]
        for q in questions:
            qid = q.get("id", "")
            answer = answers.get(qid, "")
            label = q.get("question", qid)
            if answer:
                lines.append(f"- {label}: {answer}")
            else:
                lines.append(f"- {label}: (no answer)")
        return "\n".join(lines)
