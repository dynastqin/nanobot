# Plan: 在 ToolProgressEvent 中增加 mcp_server/mcp_tool 字段

## 背景

MCP 工具名格式为 `mcp_{server_name}_{tool_name}`。当 server_name 和 tool_name 都含下划线时（如 `V5_get_user` 和 `get_user_info`），前端正则无法正确拆分出 server_name 和 tool_name，导致 AgentActivityCluster 展示异常。

## 方案

不再从工具名中拆分，改为在 ToolProgressEvent 中显式传递 `mcp_server` 和 `mcp_tool` 字段。后端通过 ToolRegistry 查找 Tool 实例并注入元数据，前端优先读取字段，兜底走正则（兼容历史数据）。

## 改动文件

| 文件 | 改动 |
|---|---|
| `nanobot/agent/tools/base.py` | Tool 基类增加 mcp_server/mcp_tool 属性（默认返回 None） |
| `nanobot/agent/tools/mcp.py` | MCPToolWrapper 覆写属性；还原 _sanitize_tool_name |
| `nanobot/agent/progress_hook.py` | 增加 tool_registry 参数；注入 MCP 元数据到事件 |
| `nanobot/agent/loop.py` | 传递 tool_registry 给 progress hook |
| `webui/src/lib/types.ts` | ToolProgressEvent 增加 mcp_server?/mcp_tool? |
| `webui/src/components/thread/AgentActivityCluster.tsx` | 优先读字段，兜底正则 |
| `tests/tools/test_mcp_tool.py` | 还原断言，保留新增测试 |

## 详细步骤

### 1. Tool 基类增加属性（base.py）

```python
@property
def mcp_server(self) -> str | None:
    return None

@property
def mcp_tool(self) -> str | None:
    return None
```

### 2. MCPToolWrapper 覆写属性，还原 _sanitize_tool_name（mcp.py）

```python
# 还原
def _sanitize_tool_name(server_name: str, tool_name: str) -> str:
    return _sanitize_name(f"mcp_{server_name}_{tool_name}")

# 新增属性
@property
def mcp_server(self) -> str:
    return self._server_name

@property
def mcp_tool(self) -> str:
    return self._original_name
```

删除 enabled_tools 匹配中的 old_format_name 兼容代码。

### 3. progress_hook 注入元数据（progress_hook.py）

- `__init__` 增加 `tool_registry` 可选参数
- 新增 `_extract_mcp_metadata` 方法，通过 registry 查找 Tool 实例并读取 mcp_server/mcp_tool
- `before_execute_tools` 和 `after_iteration` 中，在 skill_load 富集之后注入 mcp_server/mcp_tool

### 4. loop.py 传递 tool_registry

```python
loop_hook = AgentProgressHook(
    ...
    tool_registry=tools or self.tools,
)
```

### 5. 前端类型（types.ts）

```typescript
export interface ToolProgressEvent {
  ...
  mcp_server?: string;
  mcp_tool?: string;
}
```

### 6. 前端解析逻辑（AgentActivityCluster.tsx）

- 还原 MCP_TOOL_NAME_RE 为 `/^mcp_([a-z0-9_-]+?)_(.+)$/i`
- 还原 mcpRunFromToolName
- mcpRunFromEvent 优先检查 `event.mcp_server && event.mcp_tool`，有则直接构造 McpRunSummary；无则走正则兜底

### 7. 测试（test_mcp_tool.py）

- 还原 `___` → `_` 的断言
- 保留 _sanitize_tool_name 单元测试（预期值改回单下划线）
- 删除向后兼容测试

## 验证

1. `PYTHONPATH=$PWD uv run pytest tests/tools/test_mcp_tool.py -k "sanitize or enabled_tools or wrapper_name"` — 通过
2. `npx tsc --noEmit` — 无新增类型错误
3. WebUI 中使用带下划线的 MCP server 发起对话，确认展示正确
