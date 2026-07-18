# 前端展示会话压缩信息[done]

## 背景

会话压缩（token 预算压缩 / 空闲 TTL 压缩）是纯后端行为，`_last_summary` 摘要仅注入 LLM prompt 上下文，前端完全不可见。需要在前端展示压缩信息，让用户知道历史消息被压缩了以及压缩摘要内容。

## 关键发现

- 压缩元数据存储在 session JSONL 的 metadata 行：`last_consolidated`（已压缩消息数）、`metadata._last_summary`（`{"text": "...", "last_active": "..."}`)
- WebUI 线程接口 `build_webui_thread_response` 返回 `WebuiThreadPersistedPayload`，不含任何压缩信息
- `_handle_webui_thread_get` 已经读取了 session 数据（`read_session_file`），可以直接提取压缩元数据 — 无需额外 I/O
- `read_session_file` 的 metadata 行写了 `last_consolidated` 但读取时没提取出来，需要补上
- 前端已有类似模式：`ForkBoundaryDivider` 组件在消息列表中渲染分隔线，可作为参考

## 方案

在 thread API 响应中新增 `compaction` 字段，前端在消息列表顶部渲染一个可折叠的压缩信息横幅。

### 数据流

```
session JSONL metadata 行
  → read_session_file() 返回 last_consolidated + metadata._last_summary
  → _handle_webui_thread_get() 提取为 compaction 对象
  → HTTP 响应 data["compaction"]
  → fetchWebuiThread() → WebuiThreadPersistedPayload.compaction
  → useSessionHistory → ThreadShell → ThreadViewport → ThreadMessages
  → CompactionBanner 组件渲染
```

### API 响应新增字段

```json
{
  "compaction": {
    "summary": "The user asked about...",
    "consolidated_count": 42,
    "last_active": "2026-06-30T12:00:00"
  }
}
```
无压缩时为 `null`。`summary` 为 `"(nothing)"` 时也视为无压缩。

## 实现步骤

### Step 1: `nanobot/session/manager.py` — `read_session_file` 返回 `last_consolidated`

在 `read_session_file`（约 745 行）中，metadata 行的解析处新增：
```python
last_consolidated = data.get("last_consolidated", 0)
```
并在返回 dict 中加入 `"last_consolidated": last_consolidated`。

### Step 2: `nanobot/webui/ws_http.py` — `_handle_webui_thread_get` 提取压缩信息

将已有的 `read_session_file` 调用改为同时用于 session_messages 和 compaction 提取（避免两次调用）。在 `build_webui_thread_response` 返回后注入：

```python
compaction = None
if isinstance(session_data, dict):
    metadata = session_data.get("metadata")
    if isinstance(metadata, dict):
        last_summary = metadata.get("_last_summary")
        if isinstance(last_summary, dict) and last_summary.get("text") and last_summary["text"] != "(nothing)":
            compaction = {
                "summary": last_summary["text"],
                "consolidated_count": session_data.get("last_consolidated", 0),
                "last_active": last_summary.get("last_active"),
            }
data["compaction"] = compaction
```

### Step 3: `webui/src/lib/types.ts` — 新增类型

```typescript
export interface CompactionInfo {
  summary: string;
  consolidated_count: number;
  last_active: string | null;
}
```
并在 `WebuiThreadPersistedPayload` 中加入 `compaction?: CompactionInfo | null;`。

### Step 4: `webui/src/hooks/useSessions.ts` — `useSessionHistory` 提取 compaction

参照 `forkBoundaryMessageCount` 的模式：
- 返回类型、state 类型中加入 `compaction: CompactionInfo | null`
- 在 `fetchWebuiThread` 回调中提取 `const compaction = body.compaction ?? null;` 并写入 state
- `loadOlder` 中透传 `prev.compaction`

### Step 5: prop 传递链

- `ThreadShell.tsx` 从 `useSessionHistory` 解构 `compaction`，传给 `ThreadViewport`
- `ThreadViewport.tsx` 在 props interface 中加 `compaction`，传给 `ThreadMessages`

### Step 6: `webui/src/components/thread/ThreadMessages.tsx` — 新增 `CompactionBanner` 组件

在 props interface 中加入 `compaction?: CompactionInfo | null;`

在消息列表顶部（fork boundary 逻辑附近）渲染：

```tsx
{compaction ? <CompactionBanner info={compaction} /> : null}
```

`CompactionBanner` 组件：
- 默认折叠，显示压缩消息数量
- 点击展开后显示 LLM 摘要文本
- 参考 `ForkBoundaryDivider` 的样式风格（`text-muted-foreground`，小号字体）
- 使用 `lucide-react` 的 `Archive` + `ChevronDown` 图标（已是项目依赖）

### Step 7: i18n 新增翻译 key

`en/common.json` 的 `thread` 下新增：
```json
"compaction": {
  "banner": "Earlier messages were summarized ({{count}} messages compacted)"
}
```

## 需要修改的文件

| 文件 | 改动 |
|------|------|
| `nanobot/session/manager.py` | `read_session_file` 返回 `last_consolidated` |
| `nanobot/webui/ws_http.py` | `_handle_webui_thread_get` 提取并注入 compaction |
| `webui/src/lib/types.ts` | 新增 `CompactionInfo`，`WebuiThreadPersistedPayload` 加字段 |
| `webui/src/hooks/useSessions.ts` | `useSessionHistory` 提取和透传 compaction |
| `webui/src/components/thread/ThreadShell.tsx` | 解构 compaction 并传递 |
| `webui/src/components/thread/ThreadViewport.tsx` | props 加 compaction 并传递 |
| `webui/src/components/thread/ThreadMessages.tsx` | props 加 compaction，新增 `CompactionBanner` 组件 |
| `webui/src/i18n/locales/en/common.json` | 新增翻译 key |

## 验证方式

1. **后端**：启动 gateway，对一个已压缩的 session 调用 `GET /api/sessions/{key}/webui-thread`，确认响应中有 `compaction` 字段且内容正确
2. **前端**：`cd webui && bun run dev`，打开有压缩历史的会话，确认顶部显示可折叠的压缩横幅，点击可展开查看摘要
3. **边界情况**：
   - 无压缩的会话：无横幅显示
   - `summary` 为 `"(nothing)"`：无横幅显示
   - 分页加载更多历史消息：compaction 信息保持不变
4. **运行已有测试**：`cd webui && bun run test` 确保不破坏现有测试
