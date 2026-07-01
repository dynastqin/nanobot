# MCP 工具自定义体系

本文档描述 nanobot 中 MCP（Model Context Protocol）工具的配置、注册和运行机制。

## 架构总览

```
config.json                 WebUI Presets              MCP Server (stdio/sse/http)
    │                            │                              │
    ▼                            ▼                              │
MCPServerConfig  ◄──────  McpPreset.materialize()              │
    │                                                           │
    ▼                                                           │
connect_mcp_servers()  ────  ClientSession.initialize()  ───────┘
    │                            │
    ▼                            ▼
list_tools()              enabled_tools 白名单过滤
    │
    ▼
MCPToolWrapper(name="mcp_{server}_{tool}")  ──►  ToolRegistry.register()
    │
    ▼
Agent Loop 调用 execute() ──► session.call_tool(original_name, arguments)
```

## 1. 配置层

### MCPServerConfig

`nanobot/config/schema.py:293-304`

```python
class MCPServerConfig(Base):
    type: Literal["stdio", "sse", "streamableHttp"] | None = None
    command: str = ""          # stdio: 启动命令
    args: list[str] = []       # stdio: 命令参数
    env: dict[str, str] = {}   # stdio: 环境变量，支持 ${VAR} 引用
    cwd: str = ""              # stdio: 工作目录
    url: str = ""              # HTTP: 端点 URL
    headers: dict[str, str] = {}   # HTTP: 自定义请求头
    tool_timeout: int = 30     # 单次工具调用超时(秒)
    enabled_tools: list[str] = ["*"]  # 工具白名单，["*"] 启用全部，[] 禁用全部
```

### 在 config.json 中的位置

```json
{
  "tools": {
    "mcp_servers": {
      "<server_name>": { /* MCPServerConfig */ }
    }
  }
}
```

配置示例：

```json
{
  "tools": {
    "mcp_servers": {
      "playwright": {
        "command": "npx",
        "args": ["-y", "@playwright/mcp@latest"],
        "tool_timeout": 60,
        "enabled_tools": ["browser_navigate", "browser_snapshot"]
      },
      "my_api": {
        "type": "streamableHttp",
        "url": "https://mcp.example.com/mcp",
        "headers": {"Authorization": "Bearer ${MY_API_TOKEN}"},
        "enabled_tools": ["*"]
      }
    }
  }
}
```

### enabled_tools 过滤规则

`nanobot/agent/tools/mcp.py:758-777`

- `["*"]` — 注册所有工具（默认）
- `["tool_a", "tool_b"]` — 只注册指定工具，名称可以是原始 MCP 名或包装后的 `mcp_<server>_<tool>` 名
- `[]` — 不注册任何工具（仅连接）

## 2. 前置预设层 (WebUI Presets)

`nanobot/webui/mcp_presets_api.py:75-89`

### McpPreset 数据结构

```python
@dataclass(frozen=True)
class McpPreset:
    name: str                          # 唯一标识，如 "playwright"
    display_name: str                  # 显示名称，如 "Playwright"
    category: str                      # 分类: browser/docs/database/tools/...
    transport: Literal["stdio", "streamableHttp", "sse", "oauth"]
    server: MCPServerConfig | None     # 默认配置模板
    fields: tuple[McpPresetField, ...] # 用户需填写的凭证字段

@dataclass(frozen=True)
class McpPresetField:
    name: str
    label: str
    target: tuple[Literal["env", "url_param", "arg", "header"], str]
    secret: bool = True
    required: bool = True
    env_var: str | None = None
    placeholder: str = ""
```

### 内置预设列表

`MCP_PRESETS` 元组（第96行起）包含 20+ 个预设：

| 分类 | 预设 |
|------|------|
| 浏览器 | Browserbase, Playwright, Puppeteer, Browserless |
| 文档搜索 | Context7, Mintlify, Exa, Brave Search, Tavily, Perplexity |
| 数据 | Supabase, Neon, Tinybird, Airtable |
| 开发工具 | GitHub, GitLab, Linear, Sentry |
| 设计 | Figma |
| 通讯 | Slack |
| 支付 | Stripe |
| 平台 | Cloudflare, Vercel, Firebase, Notion |

### 用户启用流程

1. WebUI → Settings → MCP Servers → 点击预设
2. 填写 API Key 等凭证字段
3. 系统调用 `_materialize_server()` 将预设 + 凭证合并为 `MCPServerConfig`
4. 写入 `config.json`，触发热重载或提示重启

## 3. 连接与工具注册层

`nanobot/agent/tools/mcp.py:648-790`

### connect_mcp_servers 主流程

```
connect_mcp_servers(servers_dict, registry)
  │
  ├─► for each server:
  │     ├─► 自动检测 transport type (stdio/sse/streamableHttp)
  │     ├─► HTTP URL 安全校验 (SSRF 白名单)
  │     ├─► 建立传输通道
  │     │    ├─ stdio: stdio_client(StdioServerParameters)
  │     │    ├─ sse: sse_client(url, httpx_client_factory)
  │     │    └─ streamableHttp: streamable_http_client(url)
  │     ├─► 过滤畸形 MCP progress 通知
  │     ├─► ClientSession.initialize()
  │     ├─► list_tools() → 按 enabled_tools 白名单过滤
  │     └─► 每个工具创建 MCPToolWrapper → registry.register()
  │
  └─► 返回 {server_name: AsyncExitStack}
```

### 传输协议对比

| 协议 | 适用场景 | 配置字段 |
|------|---------|---------|
| `stdio` | 本地命令行工具 | `command`, `args`, `env`, `cwd` |
| `sse` | 远程 HTTP SSE 服务 | `url`, `headers` |
| `streamableHttp` | 远程 HTTP 流式服务 | `url`, `headers` |

自动检测规则（`connect_single_server:668-674`）：
- 有 `command` → `stdio`
- 有 `url` 且以 `/sse` 结尾 → `sse`
- 有 `url` 其他情况 → `streamableHttp`

## 4. MCPToolWrapper

`nanobot/agent/tools/mcp.py:316-404`

```python
class MCPToolWrapper(_MCPWrapperBase):
    """将单个 MCP 工具包装为 nanobot Tool 接口"""

    def __init__(self, session, server_name, tool_def, tool_timeout=30):
        self._original_name = tool_def.name
        self._name = _sanitize_name(f"mcp_{server_name}_{tool_def.name}")
        self._description = tool_def.description or tool_def.name
        self._parameters = _normalize_schema_for_openai(raw_schema)
        self._tool_timeout = tool_timeout
```

### 关键定制点

**命名规范** — `_sanitize_name`：
- 格式：`mcp_{server_name}_{tool_name}`
- 移除特殊字符，替换为下划线
- 只保留 `[a-zA-Z0-9_-]`

**Schema 规范化** — `_normalize_schema_for_openai` (`mcp.py:234-272`)：
- 处理 `["string", "null"]` 联合类型 → 提取非 null 类型 + 添加 `nullable: true`
- 处理 `oneOf`/`anyOf` 中的 nullable 分支
- 递归处理 `properties` 和 `items`
- 确保 object 类型有 `properties` 和 `required` 字段

**执行流程** (`execute` 方法)：
1. `session.call_tool(original_name, arguments)` 调用原始 MCP 工具
2. 超时处理：`asyncio.wait_for(timeout=tool_timeout)`
3. 瞬态错误自动重试一次（1秒退避）
4. 会话断开自动重连
5. 结果内容提取为文本

### 重连机制

`_MCPWrapperBase._refresh_session_after_termination` (`mcp.py:288-313`)：
- 检测会话终止异常
- 通过 `_reconnect` 回调刷新整个 server 连接
- 获取新的 session 引用后重试

## 5. 工具加载器与注册

`nanobot/agent/tools/loader.py:30-116`

`ToolLoader` 负责发现和注册所有内建工具，但 **MCP 工具不在自动发现范围内**：
- `_SKIP_MODULES` 包含 `"mcp"`（第15行）
- MCP 工具由 `connect_mcp_servers` 直接注册

注册后在 `ToolRegistry` 中：
- `get_definitions()` 将工具按内建/MCP 分类排序（`registry.py:67-90`）
- MCP 工具（名称以 `mcp_` 开头）排在内建工具之后
- 排序保持稳定以利于 prompt 缓存

外部插件支持：通过 `entry_points(group="nanobot.tools")` 加载。

## 6. 热重载

`nanobot/agent/tools/mcp.py:957-1039` — `reload_servers`

```
reload_servers(state, registry)
  │
  ├─► 重新读取 config.json
  ├─► 比较新旧配置差异
  │    ├─ removed: 旧有、新无的 server
  │    ├─ added: 新有、旧无的 server
  │    └─ changed: 签名变化的 server
  ├─► 移除被删/变更 server 的工具 → 关闭连接
  ├─► 更新 state._mcp_servers
  └─► 连接新增/变更/之前失败的 server → 注册新工具
```

WebUI 中修改 MCP 配置后：
1. 前端调用 settings API
2. 后端写入 config.json
3. 通过 `request_mcp_reload` 发送总线消息
4. Agent loop 收到消息后调用 `reload_servers`
5. 返回结果给前端展示

## 7. 自定义 MCP 工具的操作方式

| 方式 | 操作路径 | 适用场景 |
|------|---------|---------|
| WebUI 预设启用 | Settings → MCP Servers → 点击预设 → 填凭证 | 常见 SaaS 服务 |
| WebUI 自定义添加 | Settings → MCP Servers → Add Custom | 任意 MCP 兼容服务 |
| 手动编辑配置 | 编辑 `~/.nanobot/config.json` | 批量配置、版本管理 |
| 导入外部配置 | Settings → MCP Servers → Import | 从 Cursor/Claude 等迁移 |

## 8. 关键文件索引

| 文件 | 职责 |
|------|------|
| `nanobot/config/schema.py:293-340` | `MCPServerConfig` 和 `ToolsConfig` 定义 |
| `nanobot/agent/tools/mcp.py` | MCP 连接、包装、重连、热重载全部逻辑 |
| `nanobot/agent/tools/registry.py` | `ToolRegistry` 工具注册与查找 |
| `nanobot/agent/tools/loader.py` | `ToolLoader` 工具自动发现（排除 MCP） |
| `nanobot/agent/tools/base.py:131` | `Tool` 抽象基类 |
| `nanobot/webui/mcp_presets_api.py` | WebUI MCP 预设、增删改查 API |
| `nanobot/webui/settings_routes.py:345` | MCP 预设 HTTP 路由处理 |
| `nanobot/config/loader.py` | 配置文件的读写与环境变量解析 |
