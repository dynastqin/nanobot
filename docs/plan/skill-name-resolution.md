# Plan: 技能路径解析改进 — LLM 只传技能名称

## Context

当前 `skills_section.md` 模板在系统提示词中为每个技能拼接了完整的文件路径（如 `/root/nanobot-app/.../skills/github/SKILL.md`）。多轮对话使用多个技能时，LLM 会惯性复用之前的绝对路径，但自定义技能和系统技能的父级路径不同，导致 `read_file` 找不到文件。

**目标**：`skills_section.md` 不再拼接路径，LLM 只告知技能名称，nanobot 内部按优先级（workspace/skills → nanobot/skills）自行解析。

## 方案：新增 `read_skill` 工具

新增一个专用的 `read_skill` 工具，让 LLM 通过技能名称读取 SKILL.md，内部自动按 user-first 优先级查找。

### 需要修改的文件

#### 1. `nanobot/templates/agent/skills_section.md` — 更新指令，移除路径

- 模板内容改为告知 LLM 使用 `read_skill` 工具，传入技能名称
- 不再依赖 `skills_summary` 中的路径信息

#### 2. `nanobot/agent/skills.py` — `build_skills_summary()` 移除路径

- 第 164、168 行：去掉 `` `{entry['path']}` `` 部分
- 只保留技能名称和描述

#### 3. 新建 `nanobot/agent/tools/read_skill.py` — 核心工具

- 工具名：`read_skill`
- 参数：`skill`（技能名称，必填）
- 解析逻辑：
  1. 从 `ctx.workspace/skills/{name}/SKILL.md` 查找
  2. 若不存在，从 `BUILTIN_SKILLS_DIR/{name}/SKILL.md` 查找
  3. 若都不存在，返回错误信息
- 复用 `SkillsLoader` 的加载逻辑（`load_skill()` 已有 user-first 优先级）
- 支持读去重（与 `read_file` 类似）
- 利用路径安全检查，确保只能读取 skills 目录下的文件
- scope: `{"core", "subagent", "memory"}`

#### 4. `nanobot/agent/progress_hook.py` — 扩展技能加载检测

- 修改 `_extract_skill_load()` 方法（第 82-95 行），增加对 `read_skill` 工具调用的检测
- 当工具名为 `read_skill` 时，直接从 arguments 中提取 `skill` 参数作为技能名称

#### 5. `nanobot/templates/agent/identity.md` — 更新技能路径引用（可选）

- 第 8 行 `Custom skills: {{ workspace_path }}/skills/...` 可保留，作为背景信息

### 不需要修改的文件

- `nanobot/agent/tools/filesystem.py` — `read_file` 保持原样，向后兼容
- `nanobot/agent/context.py` — 上下文构建逻辑不变
- `nanobot/security/workspace_policy.py` — 路径安全检查不变

## 验证

1. 运行 Python 测试：`uv run pytest tests/ -v -k skill`
2. 运行 lint：`uv run ruff check nanobot/agent/tools/read_skill.py`
3. 启动 gateway 验证技能列表在 WebUI 中正常显示
4. 手动测试：创建一个自定义技能（workspace/skills/test/SKILL.md），确认 `read_skill("test")` 优先读取工作区版本
