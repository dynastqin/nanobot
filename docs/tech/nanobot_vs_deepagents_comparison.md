# nanobot 与 deepagents 的 Agent 能力源码级对比

> 对比对象：
> - nanobot：`/Users/geqin/yowant/work/coding/python_project/openclaw/nanobot`
> - deepagents：`https://github.com/langchain-ai/deepagents`

## 1. 总体结论

deepagents 更像一个 LangGraph/LangChain 里的“可嵌入 Agent 构造器 / 中间件栈”，强调 todos、计划保持、子 Agent 编排、虚拟文件系统和可组合 middleware。

nanobot 更像一个完整个人助理运行时，强调多渠道会话、工具执行、长期记忆、技能系统、后台任务、cron / heartbeat、长目标续跑和真实工作区访问。

| 维度 | nanobot | deepagents |
|---|---|---|
| 定位 | 完整个人 AI assistant runtime | LangChain / LangGraph agent factory / middleware bundle |
| 主入口 | `nanobot.agent.loop.AgentLoop` | `deepagents.graph.create_deep_agent` |
| 执行模型 | 自己实现的状态机 + runner + tool registry | 基于 `langchain.agents.create_agent` 和 middleware stack |
| 会话管理 | 内建 `SessionManager`、session history、跨渠道消息 | 依赖 LangGraph state / checkpointer / store |
| 工具模型 | nanobot 自有工具协议 + MCP + CLI App + file/search/web/message/cron/spawn | LangChain tools + middleware 暴露的 tools，如 `write_todos`、`task`、filesystem tools |
| 长期记忆 | `MEMORY.md`、`history.jsonl`、Dream consolidation | `MemoryMiddleware` 读取 AGENTS.md 类文件；也可接 LangGraph store/checkpointer |
| 子 Agent | 运行时后台 subagent，结果通过 pending queue 注入主会话 | middleware 提供 `task` tool，同步调用子 Agent 并返回 concise result |
| 上下文压缩 | session 级 auto compact + history raw archive + Dream 长期归纳 | `SummarizationMiddleware` 对 messages 做模型摘要 |
| planning / todos | 没有内建 todo state；通过 long-goal / heartbeat / 文件或模型自行规划 | 内建 `TodoListMiddleware` / `write_todos`，todos 是 agent state 的一部分 |

## 2. Agent loop / runtime 架构

### nanobot

核心源码：

- `nanobot/agent/loop.py`
  - `TurnState`: `RESTORE`, `COMPACT`, `COMMAND`, `BUILD`, `RUN`, `SAVE`, `RESPOND`, `DONE`
  - `AgentLoop.run(...)`
  - `_build_initial_messages(...)`
  - `_run_agent_loop(...)`

nanobot 把一次 turn 拆成明确状态机：恢复 session、必要时压缩、处理命令、构建上下文、调用模型、保存会话、响应用户。

这说明 nanobot 是完整 runtime：它不仅构造 Agent，还负责消息总线、会话、工具、保存、响应等生命周期。

### deepagents

核心源码：

- `deepagents/graph.py`
  - `create_deep_agent(...)`

它通过 `create_agent(...)` 构造 LangChain agent，并把 deepagents 的能力作为 middleware stack 插入：

- todo middleware
- filesystem middleware
- subagent middleware
- summarization middleware
- memory middleware
- HIL middleware
- prompt caching middleware

因此 deepagents 更像在 LangChain agent 上预置了一套 Claude Code / Deep Research 风格能力包。

## 3. 上下文压缩 / context compression

### nanobot：session compact + archived summary + Dream memory

相关源码：

- `nanobot/agent/autocompact.py`
- `nanobot/agent/loop.py`
- `nanobot/agent/memory.py`
- `nanobot/agent/context.py`

nanobot 的上下文策略分几层：

1. **session history replay budget**：`AgentLoop._replay_token_budget()` 根据 `context_window_tokens` 和输出 token 预留空间。
2. **AutoCompact**：在 turn 的 `COMPACT` 阶段压缩当前 session。
3. **Archived Context Summary**：compact 后摘要以 `[Archived Context Summary]` 注入 system prompt。
4. **Recent History**：从 `history.jsonl` 读取最近历史，最多 50 条，总字符上限约 32K。
5. **Dream 长期归纳**：`MemoryStore.build_dream_prompt` 把未处理历史交给 Dream agent 做长期记忆整理。

nanobot 的压缩是运行时会话级 + 长期记忆级，更偏个人助理连续会话。

### deepagents：middleware-level summarization

相关源码：

- `deepagents/summarization.py`
- `deepagents/graph.py`

`create_deep_agent` 会加入：

```python
create_summarization_middleware(model, backend)
```

deepagents 的 summarization 是 LangChain middleware，对 message history 做摘要。它还特别处理 media reference，例如保留：

```text
<image url="/conversation_history/media/{{hash}}.png" />
```

这说明 deepagents 的压缩策略更 agent-state / middleware 化：当上下文过长时，把旧消息归纳为 summary，保留必要文件 / media 引用。

| 点 | nanobot | deepagents |
|---|---|---|
| 压缩位置 | AgentLoop 状态机 `COMPACT` 阶段 | middleware |
| 压缩目标 | session history + archived summary + Dream 长记忆 | messages summary |
| 长期效果 | 可沉淀到 `MEMORY.md` | 默认更偏当前 graph / checkpoint |
| 媒体处理 | context 支持图片 / 文件；长期记忆偏文本 | summarization prompt 专门保留 media reference |
| 更适合 | 个人助理长期连续使用 | 单个复杂 agent 任务内控上下文 |

## 4. Todos / task list 能力

### nanobot

nanobot 没有类似 deepagents 的内建 todo state schema 或 `write_todos` 工具。任务管理主要分散在：

1. **long-goal**：`long_task` / `complete_goal`，active goal 写入 session metadata。
2. **heartbeat**：`HEARTBEAT.md` 作为周期任务列表。
3. **cron**：用 `cron` tool 创建提醒 / 周期任务。
4. **普通文件 todo**：可以自己创建 markdown todo 文件，但不是 agent state 内建能力。

所以 nanobot 的 todo 偏外部持久任务系统，而不是 LLM loop 内部结构化 todo state。

### deepagents

相关源码：

- `deepagents/todos.py`
  - `TodoListMiddleware`
  - `TodoListState`
  - `write_todos`
  - `read_todos`

`TodoListMiddleware` 默认加入 deep agent。todos 是一等公民：middleware 注入 todo 工具，todos 保存在 LangGraph state，模型被鼓励用 todo list 分解复杂任务。

| 点 | nanobot | deepagents |
|---|---|---|
| 内建 todo 工具 | 无结构化 `write_todos` | 有 `TodoListMiddleware` |
| 状态存储 | long-goal metadata / HEARTBEAT.md / cron / 文件 | Agent state |
| 面向场景 | 跨 turn、跨会话、真实提醒 | 单任务内规划和进度跟踪 |
| 用户可见性 | goal / heartbeat / cron 可持久 | 主要在 agent state 和工具消息中 |

## 5. Planning 能力

nanobot 没有专门 Plan middleware。planning 主要来自：

- `SOUL.md` 中的行为规则；
- `long-goal` skill 对目标 idempotent / self-contained / bounded / done-ness 的要求；
- active goal 续跑提示；
- `spawn` 子任务拆分。

所以 nanobot 的 planning 是 prompt / protocol 层，不强制结构化 plan state。

 deepagents 的 planning 主要通过 todo list 实现，属于结构化计划执行。没有单独叫 `PlanMiddleware` 的核心模块，但 `TodoListMiddleware` 实际承担 planning 功能。

| 点 | nanobot | deepagents |
|---|---|---|
| plan 形态 | 自然语言 plan + long-goal | todo state |
| 是否强约束 | 弱，依赖 prompt / skill | 强，工具和 state 支持 |
| 跨 turn | long-goal 更强 | 取决于 LangGraph checkpoint |
| 单次复杂任务可观测性 | 较弱，除非写文件 / 目标 | 较强，todos 可读写 |

## 6. Subagents

### nanobot：后台 subagent，异步结果注入主 loop

相关源码：

- `nanobot/agent/subagent.py`
- `nanobot/agent/tools/spawn.py`
- `nanobot/agent/loop.py`

特点：

- 子 agent 在后台运行；
- 主 loop 通过 pending queue 接收结果；
- `_drain_pending` 在当前 turn 内等待 subagent completion 并转成 user message 注入；
- 支持取消 active subagents。

这更像个人助理运行时里的后台工作线程 / 子助手。

### deepagents：`task` 工具同步调用子 Agent

相关源码：

- `deepagents/subagents.py`
  - `SubAgentMiddleware`
  - `_build_task_tool`
  - `create_sub_agent`
- `deepagents/graph.py`

`SubAgentMiddleware` 会给主 agent 加一个 `task` tool。每个 subagent 可有独立 name、description、system prompt、model、tools。主 agent 通过 task 工具选择子 agent，并获得 clean / concise result。

| 点 | nanobot | deepagents |
|---|---|---|
| 调用形态 | `spawn` 后台执行 | `task` tool 调用 |
| 异步性 | 原生后台异步 | 主要同步；另有 async subagents 支持 LangSmith deployment |
| 结果回流 | pending queue 注入主 loop | tool result 返回 |
| 子 Agent 配置 | 使用同一 nanobot runtime 能力 | 每个 SubAgent 指定 model / tools / system prompt |
| 适合 | 长任务并发、后台研究 | 单任务内专家委派 |

## 7. Memory

### nanobot：个人助理长期记忆系统

相关源码：

- `nanobot/agent/memory.py`
- `nanobot/agent/context.py`
- workspace：`memory/MEMORY.md`、`memory/history.jsonl`、`SOUL.md`、`USER.md`

nanobot 维护：

- `MEMORY.md`：长期事实；
- `history.jsonl`：append-only 历史；
- Dream cursor；
- recent history 注入；
- Dream prompt 归纳历史。

这是一套完整 personal memory pipeline。

### deepagents：AGENTS.md 风格 memory middleware

相关源码：

- `deepagents/memory.py`
- `deepagents/graph.py`

`MemoryMiddleware` 从配置的 sources 读取 markdown 文件并注入 system prompt，例如：

```python
sources=[
    "~/.deepagents/AGENTS.md",
    "./.deepagents/AGENTS.md",
]
```

特点：多个 AGENTS.md source 顺序拼接，HTML comments 会被剥离，memory contents 是 private state。它更像项目上下文 / agent instructions，不是完整个人长期记忆系统。

| 点 | nanobot | deepagents |
|---|---|---|
| 记忆类型 | 个人长期记忆 + 会话历史 + Dream 整理 | AGENTS.md / project instructions |
| 写入机制 | history append + Dream consolidation | 主要加载 sources；可通过工具改文件 |
| 注入位置 | system prompt `# Memory` + recent history | middleware 追加 system message |
| 用户画像 | `USER.md` / `SOUL.md` | 没有内建同等级用户画像 |
| 长期自动整理 | 有 Dream | 无同等内建机制 |

## 8. 文件系统 / 工作区模型

nanobot 有自己的工具系统：`read_file`、`write_file`、`edit_file`、`apply_patch`、`find_files`、`grep`、`exec`、`message`、`cron`、`spawn`、web tools、Playwright tools、MCP tools 等，并通过 workspace scope / sandbox 做权限控制。

deepagents 使用 backend abstraction，例如 `FilesystemBackend`、backend protocol、filesystem tools，并可叠加 HIL permissions。

| 点 | nanobot | deepagents |
|---|---|---|
| 文件系统 | 本地 workspace + 权限边界 | backend abstraction |
| 安全 | workspace scope + tool contract | HIL middleware / permissions |
| 工具广度 | 更广，含消息 / cron / browser / web / MCP | 更聚焦 coding / research agent |
| 虚拟化 | 较少，偏真实本地 | 更强，backend 可替换 |

## 9. Skills / Middleware 扩展模型

### nanobot skills

相关源码：

- `nanobot/agent/skills.py`
- workspace `skills/{skill-name}/SKILL.md`

nanobot skills 是 markdown 驱动：trigger description、read `SKILL.md` 后按步骤执行，可带 scripts / references / assets。它本质是 prompt-level capability package。

### deepagents middleware

deepagents 扩展主要是 LangChain middleware：`before_model`、`after_model`、`wrap_model_call`、tools、state schema 等。它可以直接修改 state、拦截模型调用、注入工具。

| 点 | nanobot skills | deepagents middleware |
|---|---|---|
| 形式 | Markdown 指南 + 可选脚本 | Python middleware |
| 面向谁 | 终端用户 / 高级用户可配置 | 开发者 |
| 能否改 agent state | 间接 | 直接 |
| 易用性 | 高 | 需要写代码 |
| 可组合性 | prompt 组合 | middleware stack 组合 |

## 10. 人机协作 / Human-in-the-loop

nanobot 的 HIL 更多来自运行环境和工具限制：workspace scope、dangerous command block、工具失败 / 权限错误、用户确认规则通过 SOUL / AGENTS / skill 表达。

deepagents 有更框架化的 HIL：`HumanInTheLoopMiddleware(interrupt_on=...)`，适合 LangGraph pause / resume、人审工具调用。

## 11. 重点能力逐项对比

| 能力 | nanobot | deepagents | 判断 |
|---|---|---|---|
| 上下文压缩 | `AutoCompact` + archived summary + recent history + Dream | `SummarizationMiddleware` | nanobot 更偏长期会话；deepagents 更偏 graph 内 message 压缩 |
| todos | 无内建结构化 todo state；用 long-goal / heartbeat / 文件替代 | 内建 `TodoListMiddleware` / `write_todos` | deepagents 更强 |
| plan | prompt / skill / long-goal 驱动 | todo state 驱动 | deepagents 单任务更强，nanobot 跨 turn 更强 |
| subagents | `spawn` 后台异步 subagent | `SubAgentMiddleware` 的 `task` tool | nanobot 更像后台并发；deepagents 更像专家委派 |
| memory | `MEMORY.md` + `history.jsonl` + Dream + USER / SOUL | `MemoryMiddleware` 加载 AGENTS.md sources | nanobot 长期个人记忆更强 |
| 工具系统 | 自有 registry，工具很多，面向个人助理 | LangChain tools / middleware，面向 agent app | 各自定位不同 |
| HIL | 工具边界 / 规则为主 | `HumanInTheLoopMiddleware` | deepagents 更框架化 |
| 扩展 | markdown skills + MCP + CLI apps | Python middleware | nanobot 易用，deepagents 可编程性强 |
| 会话 | 内建 SessionManager | 依赖 LangGraph checkpoint / store | nanobot 更完整 |
| 多渠道 | bus / channel / websocket / telegram 等 | 无内建 | nanobot 更强 |

## 12. 最终结论

如果把二者都叫 Agent，它们其实处在不同层：

- **deepagents 是 LangChain / LangGraph 生态里的强任务型 Agent 构造器**：todos、subagents、filesystem、summarization、memory middleware 都围绕单个复杂任务的可靠执行展开。
- **nanobot 是个人助理操作系统 / 运行时**：会话、记忆、技能、工具、消息渠道、提醒、后台任务和长目标续跑都内建，更适合长期陪伴式、多渠道、本地工作流自动化。

最明显的能力差异：

1. deepagents 的 todos / planning 更结构化；
2. nanobot 的长期记忆和个人助理 runtime 更完整；
3. deepagents 的 middleware 可编程性更强；
4. nanobot 的工具生态、渠道、cron、heartbeat、spawn 后台任务更像真实助理产品。