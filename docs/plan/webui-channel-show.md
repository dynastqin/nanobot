# WebUI Channel 接入状态展示 — 实现计划

## Context

nanobot 接入 channel（比如 feishu），但 WebUI 中没有展示除 WebSocket 以外的 channel 连接状态。管理员无法在 WebUI 中直观看到哪些外部 channel（飞书、Telegram、Slack 等）已启用且运行中。需要在 WebUI 中增加 channel 状态展示功能。

前端展示目标（Settings 页新增 "Channels" 区域）：
- channel 图标/名称（Feishu、WebSocket、Telegram 等）
- 连接状态指示灯（绿色=运行中，灰色=未启用/已停止）
- 配置摘要（如 Feishu 的 app_id）
- 国际化只考虑 en 和 zh-CN

> 本 plan 先聚焦后端 API（Step 1-2），前端展示作为第二步（Step 3-4）。

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `nanobot/channels/manager.py` | 增强 `get_status()` + 新增 `get_all_channels_status()` + `_init_channels()` 传 `channel_manager=self` |
| `nanobot/webui/gateway_services.py` | `build_gateway_services()` 与 `GatewayServices` 新增 `channel_manager` 参数/字段 |
| `nanobot/webui/ws_http.py` | `GatewayHTTPHandler.__init__` 接收 `channel_manager` 并传给 `WebUISettingsRouter` |
| `nanobot/webui/settings_routes.py` | `WebUISettingsRouter.__init__` 新增 `channel_manager` 参数 + 新增 `/api/settings/channels` 路由 |
| `webui/src/lib/api.ts` | 新增 `fetchChannelsStatus()`（走 `request()`，带 token） |

**前端展示组件（第二步）：**

| 文件 | 改动类型 |
|------|----------|
| `webui/src/components/settings/SettingsView.tsx` | 新增 "Channels" 区域 |
| `webui/src/components/ConnectionBadge.tsx` | 优先复用现有组件展示状态灯（确认三态支持后再决定是否新建） |
| `webui/src/i18n/locales/en/common.json` | 新增 channel 状态英文 keys |
| `webui/src/i18n/locales/zh-CN/common.json` | 新增 channel 状态中文 keys |

## 已验证的代码事实

- `display_name` 和 `is_running` 在 `BaseChannel` 上存在（`base.py:29`, `base.py:254`）
- `discover_channel_names()` 存在于 `nanobot/channels/registry.py:16`
- `ChannelsConfig` 使用 `extra="allow"`，channel 配置存为额外字段（dict）
- `build_gateway_services()` 仅在 `_init_channels()` 内、websocket channel 初始化时调用（`manager.py:114-134`），此时 `self` 即 ChannelManager 实例
- `WebUISettingsRouter` 通过注入回调做认证/响应：`self._check_api_token(request)`、`self._error_response(code, msg)`、`self._json_response(payload)`（`settings_routes.py:58-80`）—— **不存在** `_authorized()` / `_unauthorized()`
- 前端 `api.ts` 所有 settings 函数签名为 `(token: string, base = "")`，统一通过 `request()` 发 `Authorization: Bearer <token>`

## 实现步骤

### Step 1: 增强 ChannelManager 状态方法

**文件**: `nanobot/channels/manager.py`（`get_status()` 在 480-488）

增强 `get_status()`，加入 `name` / `display_name`：

```python
def get_status(self) -> dict[str, Any]:
    return {
        name: {
            "name": name,
            "display_name": channel.display_name,
            "enabled": True,
            "running": channel.is_running,
        }
        for name, channel in self.channels.items()
    }
```

新增 `get_all_channels_status()`，返回所有 channel（含未启用 + 插件 channel）。
**关键**：候选集合必须与 `_init_channels()` 一致——既要 `discover_channel_names()`，也要合并 `__pydantic_extra__`（`manager.py:91-92`），否则 entry-point 插件 channel 会被漏掉：

```python
def get_all_channels_status(self) -> list[dict[str, Any]]:
    """返回所有 channel 的状态（含未启用的和插件注册的）。"""
    from nanobot.channels.registry import discover_channel_names

    candidate_names = set(discover_channel_names())
    extra = getattr(self.config.channels, "__pydantic_extra__", None) or {}
    candidate_names.update(extra.keys())

    result: list[dict[str, Any]] = []
    for name in sorted(candidate_names):
        channel = self.channels.get(name)
        if channel is not None:
            result.append({
                "name": name,
                "display_name": channel.display_name,
                "enabled": True,
                "running": channel.is_running,
            })
            continue
        # 未启用：从 config 读 enabled（dict 或 model 两种形态，复刻 _init_channels 逻辑）
        section = getattr(self.config.channels, name, None)
        if section is None:
            enabled = False
        elif isinstance(section, dict):
            enabled = bool(section.get("enabled", False))
        else:
            enabled = bool(getattr(section, "enabled", False))
        result.append({
            "name": name,
            "display_name": name.title(),
            "enabled": enabled,
            "running": False,
        })
    return result
```

### Step 2: ChannelManager 引用传递链路

`settings_routes.py` 当前无法获取运行时 channel 状态，需把 `ChannelManager` 实例传给 `WebUISettingsRouter`。

**链路**: `_init_channels()` → `build_gateway_services()` → `GatewayHTTPHandler` → `WebUISettingsRouter`

**2a.** `gateway_services.py` — `build_gateway_services()` 新增 `channel_manager` 参数，`GatewayServices` dataclass 新增字段（默认 `None` 保证向后兼容）：

```python
def build_gateway_services(
    *,
    channel_manager: Any | None = None,  # 新增
    ...
) -> GatewayServices:
    ...
# dataclass 新增:
channel_manager: Any | None = None
```

**2b.** `ws_http.py` — `GatewayHTTPHandler.__init__` 接收 `channel_manager`，传给 `WebUISettingsRouter`。

**2c.** `settings_routes.py` — `WebUISettingsRouter.__init__` 新增 `channel_manager` 参数并存储，新增路由与 handler。
**注意**：使用实际存在的注入回调，不要用不存在的 `_authorized()` / `_unauthorized()`：

```python
# dispatch() 中新增（在 return None 之前）:
if path == "/api/settings/channels":
    return self._handle_settings_channels(request)

def _handle_settings_channels(self, request):
    if not self._check_api_token(request):
        return self._error_response(401, None)
    if self._channel_manager is None:
        return self._json_response({"channels": []})
    return self._json_response({"channels": self._channel_manager.get_all_channels_status()})
```

**2d.** `manager.py` — `_init_channels()` 中构造 `build_gateway_services(...)` 时传入 `channel_manager=self`（`manager.py:119`）。

### Step 3: 新增前端 API 调用

**文件**: `webui/src/lib/api.ts`

必须遵循现有模式：带 `token` 参数、走 `request()`（自动加 Bearer header），不要用裸 `fetch()`：

```typescript
export interface ChannelStatus {
  name: string;
  display_name: string;
  enabled: boolean;
  running: boolean;
}

export async function fetchChannelsStatus(
  token: string,
  base: string = "",
): Promise<{ channels: ChannelStatus[] }> {
  return request<{ channels: ChannelStatus[] }>(
    `${base}/api/settings/channels`,
    token,
    undefined,
    API_READ_TIMEOUT_MS,
  );
}
```

### Step 4: 前端展示（Settings "Channels" 区域）

1. 在 `SettingsView.tsx` 新增 "Channels" 区域，调用 `fetchChannelsStatus(token)` 渲染列表。
2. 状态灯优先复用 `webui/src/components/ConnectionBadge.tsx`；先确认其 props 是否支持 running / stopped / disabled 三态，若不支持再考虑扩展或新建 `ChannelStatusBadge.tsx`。
3. i18n（仅 en + zh-CN），在两个 `common.json` 中新增 keys，组件通过 `useTranslation()` 的 `t(...)` 消费：

```jsonc
// webui/src/i18n/locales/en/common.json
"settings.channels.title": "Channels",
"settings.channels.running": "Running",
"settings.channels.stopped": "Stopped",
"settings.channels.disabled": "Disabled"
// webui/src/i18n/locales/zh-CN/common.json
"settings.channels.title": "频道",
"settings.channels.running": "运行中",
"settings.channels.stopped": "已停止",
"settings.channels.disabled": "未启用"
```

## 验证

1. **后端 — 带 token**：
   ```bash
   curl -H "Authorization: Bearer <token>" http://127.0.0.1:<api_port>/api/settings/channels
   ```
   应返回：
   ```json
   {
     "channels": [
       {"name": "feishu", "display_name": "Feishu", "enabled": true, "running": true},
       {"name": "websocket", "display_name": "WebSocket", "enabled": true, "running": true},
       {"name": "telegram", "display_name": "Telegram", "enabled": false, "running": false}
     ]
   }
   ```
2. **后端 — 不带 token**：应返回 401（确认认证生效）。
3. **前端**：在 Settings "Channels" 区域确认列表正确渲染、状态灯颜色正确、中英文切换正常。
4. **Lint**：`ruff check nanobot/`；前端 `cd webui && bun run build`。

## 风险点

- `channel_manager` 引用传递链路较长（4 个文件），每个环节默认值设为 `None` 保证向后兼容
- `get_all_channels_status()` 必须合并 `discover_channel_names()` 与 `__pydantic_extra__`，否则漏掉插件 channel
- 前端函数必须带 token 走 `request()`，否则 401
- 后端 handler 必须使用 `_check_api_token` / `_error_response`，不存在 `_authorized` / `_unauthorized`
- websocket channel 初始化时 `self`（ChannelManager）已存在，时序上可安全传 `channel_manager=self`
