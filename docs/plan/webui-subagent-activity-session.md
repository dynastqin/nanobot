# Plan B: 子代理独立会话展示（openclaw 风格）
> 状态： 废弃，不实现

## Context

当通过 `SpawnTool` 生成子代理执行任务时，子代理的工具调用活动在 WebUI 中完全不可见。本方案参考 openclaw 的设计思路：**每个子代理获得独立的 sidebar 会话/线程**，子代理的工具调用、推理等展示在专属会话中，主会话只显示一个可点击的"子代理完成"卡片，用户点击后切换到子代理会话查看详情。

### 对比方案 A

| 维度 | 方案 A（内联） | 方案 B（独立会话） |
|------|---------------|-------------------|
| 主线程整洁度 | 子代理活动混在主消息中 | 主线程只显示结果卡片 |
| 子代理详情 | 无独立视图 | 完整的独立会话，可回放 |
| 改动范围 | 1 个文件 | 约 6-8 个文件 |
| 架构复杂度 | 低 | 中高 |

## 核心挑战

1. **后端程序化创建会话** — 目前会话由前端通过 WebSocket `new_chat` 创建，子代理需要后端能创建会话文件并广播
2. **前端感知新会话** — 前端需要知道子代理会话的 `chat_id` 并自动订阅
3. **进度事件路由** — 子代理的 tool_events/reasoning 需要路由到子代理会话而非主会话
4. **主会话中的链接** — 子代理结果消息需要渲染为可点击的跳转卡片
5. **转录持久化** — 子代理的完整执行过程需写入独立 `.jsonl` 文件

## 设计思路

### 整体流程

```
用户发送消息
  → 主 AgentLoop 调用 SpawnTool
  → SubagentManager.spawn() 创建子代理会话（新 chat_id）
  → 后端广播 session_updated，sidebar 出现新会话
  → 前端订阅子代理会话，实时接收工具事件
  → 子代理执行完毕，结果写入子代理会话
  → 主会话收到 injected_event: "subagent_result"（含子代理 chat_id 链接）
  → 用户在主会话中看到结果卡片，点击跳转
```

### 子代理会话结构

```
子代理会话 (websocket:sub-{uuid})
  ├── 系统消息：子代理 system prompt
  ├── 用户消息：子代理任务描述
  ├── [工具调用活动] web_search, exec, read_file ...
  ├── [推理内容] reasoning blocks
  ├── [文件编辑] file edit events
  ├── 助手消息：子代理的最终回复
  └── turn_end：标记完成
```

## 修改文件清单

### 1. `nanobot/agent/subagent.py` — 核心改动

**`spawn()` 方法**：
- 生成子代理专用的 `chat_id`（如 `sub-{task_id}`）
- 创建会话并在 sidebar 中可见
- 保存子代理会话 key 到 `_task_sessions: dict[str, str]`（task_id → session_key）

**`_run_subagent()` 方法**：
- 使用子代理的 `chat_id` 构建进度回调（而非 origin 的 chat_id）
- 将子代理的系统消息和任务消息持久化到子代理会话
- 使用 `AgentProgressHook` + `CompositeHook` 发布工具事件
- 子代理的最终回复写入子代理会话

**`_announce_result()` 方法**：
- 在主会话中注入精简的结果卡片（含子代理 chat_id、label、状态、摘要）
- 发送 `session_updated` 广播使子代理会话出现在 sidebar

**新增辅助方法**：
- `_create_subagent_session()` — 创建子代理的 Session 对象和 transcript
- `_emit_session_updated()` — 广播 session_updated 事件

### 2. `nanobot/channels/websocket.py` — 广播支持

- 新增 `broadcast_session_updated(chat_id)` 方法，支持从外部（非 WebSocket handler）触发 session_updated 广播
- 或者将 `send_session_updated` 改为可被 `SubagentManager` 调用的形式

### 3. `nanobot/session/manager.py` — 会话创建

- 可能需要暴露一个方法让 `SubagentManager` 能预创建 session 文件（目前是 lazy 创建）
- 或者直接使用 `get_or_create()` 并在创建时写入初始消息

### 4. `nanobot/webui/ws_http.py` — 子代理消息格式

- 在 `_handle_webui_thread_get()` 中，将 `injected_event: "subagent_result"` 消息转换为带 `subagentRef` 字段的格式
- 或者在构建 thread 响应时，检测 subagent 消息并附加链接信息

### 5. `webui/src/lib/types.ts` — 类型扩展

```typescript
// ChatSummary 增加 parentKey
interface ChatSummary {
  // ... 现有字段
  parentKey?: string;  // 父会话 key（子代理会话指向主会话）
}

// UIMessage 增加 subagentRef
interface UIMessage {
  // ... 现有字段
  subagentRef?: {
    chatId: string;
    label: string;
    status: "running" | "ok" | "error";
    taskId: string;
  };
}
```

### 6. `webui/src/components/MessageBubble.tsx` — 渲染子代理卡片

- 检测 `message.subagentRef` 字段
- 渲染 `SubagentResultCard` 组件：
  - 显示子代理 label
  - 状态图标（运行中/成功/失败）
  - 摘要文本
  - "查看详情" 按钮，点击切换到子代理会话

### 7. `webui/src/components/thread/ThreadMessages.tsx` 或新组件

- 新增 `SubagentResultCard` 组件
- 样式：卡片形式，带跳转链接

### 8. `webui/src/hooks/useSessions.ts` 或 `App.tsx` — 自动订阅

- 当收到 `session_updated` 事件且 `chat_id` 匹配子代理模式时
- 自动调用 `client.subscribe(chatId)` 订阅子代理会话
- 确保实时进度事件能到达前端

### 9. `nanobot/webui/session_list_index.py` — 子代理会话预览

- （可选）为子代理会话提取更好的预览文本
- （可选）在 session 元数据中标记 `parent_key`

## 实现步骤

### Step 1: 后端 — 子代理会话创建与进度路由

修改 `subagent.py`：
1. 在 `spawn()` 中生成子代理 `chat_id`
2. 构建子代理进度回调（使用子代理 chat_id）
3. 组合 `AgentProgressHook` + `_SubagentHook`
4. 传入 `progress_callback` 到 `AgentRunSpec`
5. 持久化子代理初始消息到 session
6. 广播 `session_updated`

### Step 2: 后端 — 子代理结果在主会话中的呈现

修改 `_announce_result()`：
1. 不再注入完整的模板渲染文本
2. 注入结构化的子代理结果（含 chat_id、label、状态、摘要）
3. metadata 中标记 `subagent_chat_id`

### Step 3: 前端 — 类型与 API

1. 扩展 `ChatSummary` 和 `UIMessage` 类型
2. 在 `fetchWebuiThread` 响应中支持 `subagentRef` 字段
3. 在 `listSessions` 响应中支持 `parentKey` 字段

### Step 4: 前端 — UI 渲染

1. 创建 `SubagentResultCard` 组件
2. 在 `MessageBubble` 中集成
3. 点击跳转到子代理会话
4. 自动订阅子代理会话

### Step 5: 前端 — Sidebar 展示

1. （可选）子代理会话在 sidebar 中缩进或标记
2. （可选）子代理会话标题自动生成

## 数据流

```
SpawnTool.execute()
  → SubagentManager.spawn()
    → 生成 subagent_chat_id = f"sub-{task_id}"
    → 创建 Session(subagent_chat_id)
    → 写入 system prompt + user task 到 session
    → 广播 session_updated(subagent_chat_id)
    → asyncio.create_task(_run_subagent())
      → 构建 _subagent_progress (chat_id=subagent_chat_id)
      → AgentProgressHook(on_progress=_subagent_progress)
      → AgentRunner.run(AgentRunSpec(hook=CompositeHook, progress_callback=_subagent_progress))
        → 工具执行 → before_execute_tools → tool_hint → WebSocket → 前端子代理会话
        → 工具完成 → after_iteration → tool_events → WebSocket → 前端子代理会话
        → 推理内容 → emit_reasoning → reasoning_delta → WebSocket → 前端子代理会话
      → 子代理完成
      → _announce_result()
        → bus.publish_inbound(InboundMessage(
            channel="system",
            chat_id=origin.chat_id,
            metadata={
              "injected_event": "subagent_result",
              "subagent_task_id": task_id,
              "subagent_chat_id": subagent_chat_id,
              "subagent_label": label,
              "subagent_status": "ok"/"error",
            }
          ))
        → 主 AgentLoop 处理 → 主会话显示 SubagentResultCard
```

## 注意事项

1. **子代理会话的 chat_id 格式**：建议使用 `sub-{task_id}` 与普通会话区分，方便前端做特殊处理
2. **会话清理**：子代理会话的生命周期？是否需要自动清理或与主会话联动删除？
3. **并发安全**：多个子代理同时运行时，各自的会话独立，无竞争问题
4. **WebSocket 订阅**：前端需要订阅子代理会话才能收到实时事件，需要在 `session_updated` 或 `new_chat` 流程中处理
5. **转录回放**：子代理会话的 `.jsonl` 文件需要包含所有 wire events（tool_hint, reasoning_delta, delta, stream_end, turn_end），确保回放完整性
6. **向后兼容**：旧的 `injected_event: "subagent_result"` 消息没有 `subagent_chat_id`，前端需处理降级显示

## 验证

1. 启动 gateway：`nanobot gateway`
2. 启动 webui dev server：`cd webui && bun run dev`
3. 在 WebUI 中发送需要 spawn 子代理的消息
4. 确认 sidebar 中出现新的子代理会话
5. 点击子代理会话，查看工具调用、推理等是否完整展示
6. 回到主会话，确认结果卡片正确渲染
7. 点击结果卡片的"查看详情"，确认正确跳转
8. 测试多个并发子代理
9. 测试子代理失败场景
10. 运行现有测试：`cd webui && bun run test` 和 `uv run pytest tests/ -v -k subagent`
