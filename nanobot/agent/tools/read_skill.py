"""Read a skill's SKILL.md by name with user-first resolution."""

import os
from pathlib import Path
from typing import Any

from loguru import logger
from nanobot.agent.skills import BUILTIN_SKILLS_DIR, SkillsLoader
from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.file_state import FileStates, _hash_file, current_file_states
from nanobot.agent.tools.schema import BooleanSchema, StringSchema, tool_parameters_schema


@tool_parameters(
    tool_parameters_schema(
        skill=StringSchema("The skill name to read (directory name under skills/)"),
        force=BooleanSchema(
            description="Bypass same-skill read deduplication and return content again.",
            default=False,
        ),
        required=["skill"],
    )
)
class ReadSkillTool(Tool):
    """Read a skill's SKILL.md by name, resolving workspace skills before built-in skills."""

    _scopes = {"core", "subagent", "memory"}

    def __init__(
        self,
        loader: SkillsLoader,
        file_states: FileStates | None = None,
    ):
        self._loader = loader
        self._explicit_file_states = file_states
        self._fallback_file_states = FileStates()

    @classmethod
    def create(cls, ctx: Any) -> Tool:
        loader = SkillsLoader(Path(ctx.workspace), builtin_skills_dir=BUILTIN_SKILLS_DIR)
        return cls(loader=loader, file_states=ctx.file_state_store)

    @property
    def name(self) -> str:
        return "read_skill"

    @property
    def description(self) -> str:
        return (
            "Read a skill's SKILL.md content by skill name. "
            "Resolves workspace skills before built-in skills. "
            "Use this instead of read_file to load skill instructions."
        )

    @property
    def read_only(self) -> bool:
        return True

    @property
    def _file_states(self) -> FileStates:
        if self._explicit_file_states is not None:
            return self._explicit_file_states
        return current_file_states(self._fallback_file_states)

    async def execute(self, skill: str | None = None, force: bool = False, **kwargs: Any) -> str:
        if not skill:
            return "Error: skill name is required."

        content = self._loader.load_skill(skill)
        if content is None:
            available = [e["name"] for e in self._loader.list_skills(filter_unavailable=False)]
            hint = ""
            if available:
                hint = f" Available skills: {', '.join(sorted(available))}"
            return f"Error: Skill '{skill}' not found.{hint}"

        # Resolve the actual file path for dedup tracking
        roots = [self._loader.workspace_skills]
        if self._loader.builtin_skills:
            roots.append(self._loader.builtin_skills)
        resolved_path = None
        for root in roots:
            candidate = root / skill / "SKILL.md"
            if candidate.exists():
                resolved_path = candidate
                break

        skill_dir = None
        if resolved_path is not None:
            skill_dir = str(resolved_path.parent)
            entry = self._file_states.get(resolved_path)
            try:
                current_mtime = os.path.getmtime(resolved_path)
            except OSError:
                current_mtime = 0.0
            if (
                not force
                and entry
                and entry.can_dedup
            ):
                if current_mtime != entry.mtime:
                    entry.can_dedup = False
                else:
                    current_hash = _hash_file(str(resolved_path))
                    if current_hash == entry.content_hash:
                        return f"[Skill unchanged since last read: {skill}]"
                    else:
                        entry.can_dedup = False

            self._file_states.record_read(resolved_path)

        logger.info(f"load skill({skill}) ok from [{resolved_path}]")
        if skill_dir:
            return f"[Skill directory: {skill_dir}]\n\n{content}"
        return content
