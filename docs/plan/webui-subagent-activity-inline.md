# Plan A: 子代理活动内联展示（含主子任务区分）
> 状态： 已完成

## Context

当通过 `SpawnTool` 生成子代理执行任务时（如 web_search、命令执行、文件编辑等），子代理的工具调用活动在 WebUI 的 `AgentActivityCluster` 中完全不可见。用户看不到子代理正在做什么。

**根因**：`SubagentManager._run_subagent()` 调用 `self.runner.run(AgentRunSpec(...))` 时：
- 使用了 `_SubagentHook`，它只做日志和状态更新，**不发布进度事件到消息总线**
- 没有传递 `progress_callback` 给 `AgentRunSpec`
- 没有使用 `AgentProgressHook`

而主 agent loop 使用 `AgentProgressHook` + `build_bus_progress_callback()` 将工具事件（tool_events）、推理内容（reasoning）、文件编辑事件通过消息总线发布到 WebSocket channel，再由前端渲染。

**主子任务混淆问题**：如果子代理的进度事件直接以普通 progress 消息发布，前端会将其与主代理的工具调用以相同样式渲染，用户无法区分哪些操作是主代理做的、哪些是子代理做的。需要在前端按 `subagentTaskId` 分组并嵌套渲染。

## 设计思路

子代理的工具调用、web_search、命令执行等活动**出现在当前聊天会话中**，但在视觉上与主代理的工具调用区分：
- 子代理的活动自动分组，嵌套缩进在子代理标签下方
- 子代理标签显示任务标题（如 "搜索资料"、"分析代码"），可折叠
- 子代理内部的 reasoning 和 tool calls 在组内独立展示

## 修改文件

### 后端（1 个文件）

`nanobot/agent/subagent.py` — 构建进度回调并传递 `_subagent_task_id` + `_subagent_title`

### 前端（4 个文件）

| 文件 | 改动 |
|---|---|
| `webui/src/lib/types.ts` | `UIMessage` 增加 `subagentTaskId?: string`、`subagentTitle?: string` |
| `webui/src/hooks/useNanobotStream.ts` | 从 wire event metadata 提取子代理字段写入 `UIMessage` |
| `webui/src/components/thread/AgentActivityCluster.tsx` | 新增 `SubagentActivityGroup` 组件，按 `subagentTaskId` 分组渲染 |
| `webui/src/lib/activity-timeline.ts` | `normalizeActivityTimeline` 可能需适配子代理分组 |

## 具体实现

### 1. 后端：`nanobot/agent/subagent.py`

在 `_run_subagent()` 中构建进度回调并传递给 AgentRunner：

```python
from nanobot.agent.hook import CompositeHook
from nanobot.agent.progress_hook import AgentProgressHook
from nanobot.bus.events import OutboundMessage

# 构建进度回调，发布到消息总线（路由到原始 channel/chat_id）
async def _subagent_progress(
    content: str,
    *,
    tool_hint: bool = False,
    tool_events: list[dict[str, Any]] | None = None,
    file_edit_events: list[dict[str, Any]] | None = None,
    reasoning: bool = False,
    reasoning_end: bool = False,
) -> None:
    meta: dict[str, Any] = {}
    meta["_progress"] = True
    meta["_tool_hint"] = tool_hint
    meta["_subagent_task_id"] = task_id       # 子代理任务 ID，前端用于分组
    meta["_subagent_title"] = title            # 子代理任务标题，前端用于标签
    if reasoning:
        meta["_reasoning_delta"] = True
    if reasoning_end:
        meta["_reasoning_end"] = True
    if tool_events:
        meta["_tool_events"] = tool_events
    if file_edit_events:
        meta["_file_edit_events"] = file_edit_events
    await self.bus.publish_outbound(OutboundMessage(
        channel=origin["channel"],
        chat_id=origin["chat_id"],
        content=content,
        metadata=meta,
    ))

# 组合 hook
subagent_hook = _SubagentHook(task_id, status)
progress_hook = AgentProgressHook(on_progress=_subagent_progress)
hook = CompositeHook([progress_hook, subagent_hook])

result = await self.runner.run(AgentRunSpec(
    initial_messages=messages,
    tools=tools,
    model=self.model,
    ...
    hook=hook,
    progress_callback=_subagent_progress,
    ...
))
```

其中 `title` 从 task 描述中提取（如 `task.title` 或首行摘要），`task_id` 是已有的 `SubagentTask.id`。

### 2. 前端类型：`webui/src/lib/types.ts`

`UIMessage` 增加两个可选字段：

```typescript
export interface UIMessage {
  // ... 现有字段 ...
  /** 子代理任务 ID，非空表示此消息属于某个子代理 */
  subagentTaskId?: string;
  /** 子代理任务标题，用于分组标签展示 */
  subagentTitle?: string;
}
```

### 3. 前端 hook：`webui/src/hooks/useNanobotStream.ts`

在处理 `tool_hint` / `progress` / `reasoning_delta` 消息创建/更新 `UIMessage` 时，检查 wire event 的 metadata：

```typescript
// 在创建或合并 UIMessage 时：
const subagentTaskId = event.metadata?._subagent_task_id as string | undefined;
const subagentTitle = event.metadata?._subagent_title as string | undefined;
if (subagentTaskId) {
  msg.subagentTaskId = subagentTaskId;
  msg.subagentTitle = subagentTitle;
}
```

### 4. 前端渲染：`AgentActivityCluster.tsx`

新增 `SubagentActivityGroup` 组件，在 `AgentActivityCluster` 渲染前按 `subagentTaskId` 分组：

```tsx
function groupMessagesBySubagent(messages: UIMessage[]): {
  parentMessages: UIMessage[];
  subagentGroups: { taskId: string; title: string; messages: UIMessage[] }[];
} {
  const parentMessages: UIMessage[] = [];
  const subagentMap = new Map<string, { title: string; messages: UIMessage[] }>();

  for (const msg of messages) {
    if (msg.subagentTaskId) {
      const group = subagentMap.get(msg.subagentTaskId);
      if (group) {
        group.messages.push(msg);
        if (msg.subagentTitle) group.title = msg.subagentTitle;
      } else {
        subagentMap.set(msg.subagentTaskId, {
          title: msg.subagentTitle || "Sub-agent",
          messages: [msg],
        });
      }
    } else {
      parentMessages.push(msg);
    }
  }

  return {
    parentMessages,
    subagentGroups: Array.from(subagentMap.entries()).map(([taskId, g]) => ({
      taskId,
      title: g.title,
      messages: g.messages,
    })),
  };
}
```

渲染结构：

```
AgentActivityCluster
├── 主代理的 rounds（reasoning + traces）
├── SubagentActivityGroup（可折叠）
│   ├── 子代理标签："搜索资料"  ← 缩进 + 左侧 border
│   │   ├── 子代理的 reasoning
│   │   ├── 子代理的 tool traces
│   │   └── 子代理的文件编辑
│   └── ...
├── 主代理的文件编辑
└── 总耗时
```

`SubagentActivityGroup` 渲染为一个带左侧彩色边框的缩进区块，标题显示子代理任务名 + 子代理内部的 rounds（复用 `groupActivityMessages` / `groupActivityRounds`）。

### 关键复用

- `AgentProgressHook`（`nanobot/agent/progress_hook.py`）— 已有的 hook，负责在工具执行前后调用进度回调
- `CompositeHook`（`nanobot/agent/hook.py`）— 已有的组合 hook
- `OutboundMessage`（`nanobot/bus/events.py`）— 已有的出站消息类型，metadata dict 可携带任意键值
- `self.bus`（`SubagentManager` 已有属性）— 消息总线
- 前端 `groupActivityMessages` / `groupActivityRounds` — 子代理内部 rounds 直接复用

### 不需要修改的部分

- `nanobot/bus/progress.py` — `build_bus_progress_callback` 无需改动
- `nanobot/agent/progress_hook.py` — `AgentProgressHook` 无需改动
- `nanobot/agent/hook.py` — `CompositeHook` 无需改动
- `webui/src/lib/activity-timeline.ts` — `normalizeActivityTimeline` 大概率无需改动（分组发生在渲染层）
- Channel manager 的 `_send_once()` — `_subagent_task_id` / `_subagent_title` 会自动跟随 metadata 透传

## 数据流

```
子代理工具执行
  → AgentProgressHook.before_execute_tools() 调用 _subagent_progress(tool_hint=True, tool_events=[start])
  → AgentProgressHook.after_iteration() 调用 _subagent_progress(tool_hint=False, tool_events=[finish])
  → _subagent_progress 发布 OutboundMessage(
      channel=origin.channel, chat_id=origin.chat_id,
      metadata={ _subagent_task_id, _subagent_title, ... }
    )
  → WebSocketChannel.send() 将 metadata 转为 wire event payload
  → 前端 useNanobotStream 处理 tool_hint/progress/reasoning_delta
    → 提取 _subagent_task_id / _subagent_title 写入 UIMessage
  → AgentActivityCluster 按 subagentTaskId 分组
    → 主代理消息 → 正常渲染 rounds
    → 子代理消息 → SubagentActivityGroup 嵌套缩进渲染
```

## 注意事项

1. **并发子代理** — 多个子代理同时运行时，各自有独立的 `task_id`，在前端会渲染为多个独立的 `SubagentActivityGroup`
2. **子代理的 reasoning** — 会在 `SubagentActivityGroup` 内部显示 reasoning block
3. **文件编辑事件** — 会通过 `file_edit_events` 参数正确传递，在子代理组内展示
4. **子代理间的消息交错** — 前端按 `subagentTaskId` 分组，自动处理交错问题
5. **向后兼容** — `subagentTaskId` 为可选字段，主代理的现有消息不受影响
6. **子代理标题** — 优先使用后端传入的 `_subagent_title`，fallback 为 "Sub-agent"

## 验证

1. 启动 gateway：`nanobot gateway`
2. 启动 webui dev server：`cd webui && bun run dev`
3. 在 WebUI 中发送需要 spawn 子代理的消息（如"帮我搜索一下最新的 Python 3.13 特性"）
4. 观察 AgentActivityCluster：
   - 主代理的 reasoning 和 tool calls 正常渲染
   - 子代理的活动以缩进区块出现，带有子代理标题标签
   - 子代理内部 reasoning 和 tool calls 可折叠查看
5. 检查并发子代理场景（同时 spawn 多个子代理）
6. 检查文件编辑事件在子代理区块内正常展示
7. 确认主代理的独立 tool calls 不受影响（无缩进、无额外标签）
8. 运行现有测试：`cd webui && bun run test` 和 `uv run pytest tests/ -v -k subagent`
