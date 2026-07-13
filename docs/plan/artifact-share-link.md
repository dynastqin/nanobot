# Artifact Share Link Feature

## Context

nanobot 的 Artifact 文件（存储在 `<workspace>/outputs/<session>` 目录中，由 `outputs_dir_for_session()` 生成）目前只能在右侧抽屉面板中预览。用户希望能生成一个可直接在浏览器中打开的链接，类似分享功能，让文件可以被外部访问或在其他标签页中查看。

### 关键需求

- **默认永久分享**：用户点击 Share 按钮后，默认生成永久有效的分享链接
- **用户可调整有效期**：提供 1 天 / 7 天 / 永久的选项
- **分享结果展示**：弹窗中显示生成的 URL，可直接复制，并清晰展示有效期
- **分享状态持久化**：已生成的分享链接在文件树中可见，无需重复生成

## Design

### Backend

#### 0. Persistent gateway signing secret（预留）

**`nanobot/config/gateway_secret.py`** — 新增模块

引入 gateway 级别的持久签名密钥 `gateway_secret`，供未来需要跨重启持久化签名的功能复用。当前 artifact share 采用 token 方案，暂不依赖此模块。

- 文件路径: `~/.nanobot/data/gateway_secret`（一行 base64 编码的 32 字节随机数据）
- 首次启动时: `secrets.token_bytes(32)` → base64 → 写入文件
- 后续启动时: 直接读取文件内容 → base64 decode
- 文件权限: `0o600`（仅 owner 可读写）

```python
def load_or_create_gateway_secret() -> bytes:
    """Load persistent signing secret from disk, or create it on first run."""
```

#### 1. New module: `nanobot/webui/artifact_share.py`

核心逻辑：生成随机 token，将 token → 文件路径映射存储在 `.shares.json` 中。

**Token 方案**（非 HMAC 签名）:
- 12 随机字节 → 24 hex 字符，96 bits 熵，不可枚举
- URL 格式: `/api/artifacts/share?t=<token>`
- Token → 文件映射存储在 session 的 outputs 目录下的 `.shares.json` 中

**`.shares.json` 格式**（keyed by relative file path）:
```json
{
  "outputs/websocket_abc123/report.md": {
    "token": "a1b2c3d4e5f6a7b8c9d0e1f2",
    "url": "/api/artifacts/share?t=a1b2c3d4e5f6a7b8c9d0e1f2",
    "expires_at": 1719936000,
    "expires_in": 0,
    "filename": "report.md"
  }
}
```

**Key functions:**

- `create_artifact_token(abs_path, workspace_path, outputs_dir, expires_at, expires_in, filename)` → `/api/artifacts/share?t=<token>` or `None`
  - 验证路径在 workspace 内（`resolve().relative_to()`）
  - 生成随机 token → 写入 `.shares.json`
  - `expires_at=0` 表示永不过期
  - 返回 URL 路径字符串

- `serve_artifact_token(token, workspace_path, outputs_dir, request)` → `Response`
  - 从 `.shares.json` 查找 token 对应的文件
  - 检查过期时间（`expires_at=0` 时跳过）
  - 通过 `resolve_allowed_path(strict=True)` 验证路径在 workspace 内
  - 推断 MIME 类型，不在白名单中的降级为 `application/octet-stream`
  - 对 HTML/SVG 设置 restrictive CSP
  - 支持 HTTP byte ranges（复用 `_parse_single_byte_range`）
  - token 未找到返回 404，过期返回 410 Gone

- `load_artifact_shares(outputs_dir)` → `dict[str, dict]` — 加载 `.shares.json`
- `validate_expires_in(expires_in)` → `int | None` — 校验有效期值

- `ARTIFACT_INLINE_MIMES`: 允许的 inline MIME 类型白名单（image/*, text/*, application/json, application/pdf, video/*, audio/* 等）

- **有效期选项**:
  | 选项 | expires_in (秒) | 说明 |
  |------|----------------|------|
  | 永久（**默认**） | 0 | 直到文件被删除或 `.shares.json` 被手动清除 |
  | 1 天 | 86400 | 临时分享 |
  | 7 天 | 604800 | 短期分享 |

- **永久链接说明**: "永久"指链接无过期时间。token 映射持久化在 `.shares.json` 中，跨 gateway 重启保持不变。"永久"链接在文件被删除或 `.shares.json` 被清除时失效。

#### 2. Gateway 集成

**`nanobot/webui/media_gateway.py`** — `WebUIMediaGateway` 扩展:
- 添加 `create_artifact_token(abs_path, outputs_dir, expires_at, expires_in, filename)` 方法 — 委托给 `artifact_share.create_artifact_token()`
- 添加 `serve_artifact_token(token, outputs_dir, request)` 方法 — 委托给 `artifact_share.serve_artifact_token()`
- 无需新增构造参数（token 方案不依赖外部 secret）

**`nanobot/webui/ws_http.py`** — `GatewayHTTPHandler` 路由:

- **`_dispatch_media_routes`** 中新增:
  ```python
  m = re.match(r"^/api/artifacts/share$", got)
  if m:
      token = _query_first(_parse_query(request.path), "t") or ""
      if token:
          return self._handle_artifact_fetch(token, request)
      return _http_error(400, "missing token")
  ```
  - `_handle_artifact_fetch` 扫描 `outputs/` 下所有子目录的 `.shares.json`，查找匹配 token
  - **无需 API token**（token 即授权）

- **`_dispatch_session_routes`** 中新增:
  ```python
  m = re.match(r"^/api/sessions/([^/]+)/artifact-share$", got)
  if m:
      return self._handle_artifact_share(request, m.group(1))
  ```
  - 需要 API token
  - 接收 GET query params: `path` 和 `expires_in`
  - `expires_in` 允许值: `0`（永久，默认）、`86400`（1天）、`604800`（7天）
  - 通过 workspace scope 解析路径
  - 验证路径在 `outputs/` 目录内
  - 返回 JSON: `{"url": "/api/artifacts/share?t=...", "expires_at": 1719936000, "expires_in": 0, "filename": "report.md"}`

#### 3. 文件树集成

**`nanobot/webui/workspace_files.py`** — 文件树 API 扩展:
- `_build_tree()` 新增 `shares_map` 和 `project_path` 参数
- `_attach_share(node, shares_map, project_path)` — 如果文件有已存在的 share，将 share 信息附加到 tree node 的 `share` 字段
- `list_workspace_files()` 在 session 上下文中自动加载 `.shares.json`，传入 tree builder
- 前端可直接从文件树获取已有 share 信息，无需额外 API 调用

#### 4. Security considerations

| Threat | Mitigation |
|--------|-----------|
| Path traversal | `resolve_allowed_path(strict=True)` + 签名时存储相对路径 + 服务时二次验证 |
| Token 枚举 | 12 字节随机 hex（96 bits 熵），不可暴力枚举 |
| 链接过期 | `.shares.json` 中存储 `expires_at` 时间戳，服务时检查，`expires_at=0` 表示不过期 |
| XSS via HTML | HTML 文件 serve 时设置 `Content-Security-Policy: sandbox; default-src 'self' 'unsafe-inline' data: blob:` |
| XSS via SVG | SVG 文件 serve 时设置 `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Token 泄露 | token 仅在 URL query string 中，通过 HTTPS 传输保护；删除 `.shares.json` 可立即失效所有链接 |
| 大文件 DoS | byte range 支持 |
| expires_in 滥用 | 后端白名单校验仅允许 0/86400/604800 |
| 分享范围限制 | 仅允许 `outputs/` 目录下的文件被分享 |

### Frontend

#### 5. API function

**`webui/src/lib/api.ts`** — 新增:
```typescript
interface ArtifactShareResult {
  url: string;
  expires_at: number;
  expires_in: number;
  filename: string;
}

async function createArtifactShare(
  token: string,
  sessionKey: string,
  path: string,
  expiresIn: number,
  base?: string,
): Promise<ArtifactShareResult>
```
- 通过 GET query params 传递 `path` 和 `expires_in`

#### 6. Types

**`webui/src/lib/types.ts`** — 新增:
```typescript
interface ArtifactShareInfo {
  url: string;
  expires_at: number;
  expires_in: number;
  filename: string;
}
```
- `WorkspaceFileNode` 新增可选字段 `share?: ArtifactShareInfo`

#### 7. Share button component

**`webui/src/components/ArtifactShareButton.tsx`** — 新组件:

Props: `token, sessionKey, filePath, className?, variant?: "icon" | "icon-sm", initialShare?: ArtifactShareResult | null`

**variant**: `"icon"`（默认，h-8 w-8）用于全屏预览；`"icon-sm"`（h-7 w-7）用于面板/抽屉工具栏

**交互流程:**

1. 点击 Share 按钮 → 弹出 Popover
2. Popover 内容分为两个阶段：

**阶段 1 — 创建分享（初始状态）：**
- 有效期选择器（Segmented 按钮组）:
  - **永久**（默认选中，`expires_in=0`）
  - 1 天
  - 7 天
- "生成链接" 按钮（调用 `createArtifactShare()`）

**阶段 2 — 分享结果（生成成功后）：**
- 显示生成的完整 URL（`window.location.origin + url`），放在 code block 中
- **有效期标签**：显示文字说明
  - 永久 → "永久有效" / "Permanent"
  - 有期限 → "有效期至 xxx" / "Expires at xxx"
  - 已过期 → 显示 "已失效" / "Expired" 标记
- **复制链接按钮**：点击复制完整 URL 到剪贴板（Copy → Check 动画反馈）
- **重新生成按钮**（RefreshCcw 图标）：返回阶段 1

**initialShare 机制:**
- 如果传入 `initialShare`（从文件树的 `share` 字段获取），打开 popover 时直接显示已有链接，无需重新请求
- 用户仍可点击"重新生成"创建新链接

**边界处理:**
- 切换 session 时自动重置状态
- 点击 popover 外部自动关闭
- 加载中显示 Loader2 动画

#### 8. 集成到现有 toolbar

在以下位置添加 Share 按钮（使用 `Share2` icon from lucide-react）:

- **`FileFullscreenPreview.tsx`** — toolbar Actions 区域，Copy 和 Download 按钮旁边（`variant="icon"`）
- **`SessionDrawer.tsx`** `FilesTab` toolbar — Copy 和 Download 按钮旁边（`variant="icon-sm"`）
- **`FilePreviewPanel.tsx`** — breadcrumb bar 右侧（`variant="icon-sm"`）

按钮仅在文件路径包含 `outputs/` 时显示（即只分享 artifact 输出文件）。

所有位置均传入 `initialShare` 以复用文件树中已有的分享信息。

#### 9. ThreadShell 状态传递

**`webui/src/components/thread/ThreadShell.tsx`**:
- 新增 `fullscreenShare` 状态
- `onOpenFileFullscreen` 回调签名变更为 `(path: string, share?: ArtifactShareResult | null) => void`
- 将 share 信息传递给 `FileFullscreenPreview`

#### 10. i18n

**`webui/src/i18n/locales/en/common.json`** + **`webui/src/i18n/locales/zh-CN/common.json`**:

```json
{
  "artifact": {
    "share": "Share",
    "shareTitle": "Share File",
    "generateLink": "Generate Link",
    "regenerate": "Regenerate",
    "copyLink": "Copy Link",
    "copied": "Link copied",
    "expiresIn": "Expires",
    "permanent": "Permanent",
    "1d": "1 day",
    "7d": "7 days",
    "expiresAt": "Expires at {{date}}",
    "expired": "Expired",
    "urlLabel": "Share URL"
  }
}
```

中文对应：
```json
{
  "artifact": {
    "share": "分享",
    "shareTitle": "分享文件",
    "generateLink": "生成链接",
    "regenerate": "重新生成",
    "copyLink": "复制链接",
    "copied": "链接已复制",
    "expiresIn": "有效期",
    "permanent": "永久",
    "1d": "1 天",
    "7d": "7 天",
    "expiresAt": "有效期至 {{date}}",
    "expired": "已失效",
    "urlLabel": "分享链接"
  }
}
```

## Files

### Backend (Python)
| File | Change |
|------|--------|
| `nanobot/config/gateway_secret.py` | **NEW** — 持久签名密钥加载/创建逻辑（预留，当前未被 artifact share 使用） |
| `nanobot/webui/artifact_share.py` | **NEW** — Token 生成、`.shares.json` 持久化、文件服务逻辑 |
| `nanobot/webui/media_gateway.py` | 添加 `create_artifact_token()` / `serve_artifact_token()` 委托方法 |
| `nanobot/webui/ws_http.py` | 添加 2 个路由: `/api/artifacts/share?t=` (fetch) + `/api/sessions/{key}/artifact-share` (create) |
| `nanobot/webui/workspace_files.py` | `_build_tree()` 支持 `shares_map` 参数；新增 `_attach_share()` 在文件树中附加已有 share 信息 |

### Frontend (TypeScript/React)
| File | Change |
|------|--------|
| `webui/src/lib/api.ts` | 添加 `ArtifactShareResult` 接口 + `createArtifactShare()` |
| `webui/src/lib/types.ts` | 添加 `ArtifactShareInfo` 接口；`WorkspaceFileNode` 新增 `share?` 字段 |
| `webui/src/components/ArtifactShareButton.tsx` | **NEW** — Share 按钮 + Popover 组件（有效期选择、结果展示、复制、重新生成、过期检测） |
| `webui/src/components/FileFullscreenPreview.tsx` | 添加 `initialShare` prop；toolbar 中集成 Share 按钮（仅 outputs 文件） |
| `webui/src/components/thread/SessionDrawer.tsx` | `shareMap` 从 tree 提取 share 信息；FilesTab toolbar 集成 Share 按钮；`onOpenFileFullscreen` 传递 share |
| `webui/src/components/FilePreviewPanel.tsx` | 添加 `initialShare` prop；breadcrumb bar 集成 Share 按钮（`variant="icon-sm"`） |
| `webui/src/components/thread/ThreadShell.tsx` | 新增 `fullscreenShare` 状态；传递 share 到 `FileFullscreenPreview` |
| `webui/src/i18n/locales/en/common.json` | 添加 `artifact.*` i18n keys（含 `expired`） |
| `webui/src/i18n/locales/zh-CN/common.json` | 添加 `artifact.*` i18n keys（含 `expired`） |

### Tests
| File | Change |
|------|--------|
| `tests/webui/test_artifact_share.py` | **NEW** — Token 生成/验证/过期/安全测试 |

## Verification

1. **Unit tests**: `pytest tests/webui/test_artifact_share.py -v`
   - Token 生成和 URL 格式
   - 过期链接返回 410 Gone
   - 永久链接（`expires_in=0`）不过期
   - 路径越界拒绝
   - 文件不存在返回 404
   - HTML/SVG CSP headers 正确
   - MIME 白名单与降级
   - 非法 expires_in 拒绝
   - `X-Content-Type-Options: nosniff`
   - `Content-Disposition: inline`

2. **Integration test**: 启动 gateway，创建 share 链接，用 curl 直接访问（不带 token），验证文件内容返回

3. **Frontend test**: `cd webui && bun run test`
   - Share 按钮渲染（仅在 outputs 路径时显示）
   - Popover 交互：默认选中"永久"
   - 生成链接后显示 URL 和有效期信息
   - 复制按钮功能
   - initialShare 直接展示已有链接

4. **Manual E2E**:
   - 打开 WebUI → 在 session 的 outputs 目录中选择一个文件
   - 点击 Share 按钮 → 弹窗默认选中"永久"
   - 点击"生成链接" → 显示 URL 和"永久有效"
   - 点击复制按钮 → 复制成功（Check 动画）
   - 在新标签页中打开链接 → 文件正确渲染（inline）
   - 切换有效期到"1 天"→ 重新生成 → 显示"有效期至 xxx"
   - 刷新页面 → 文件树中仍显示已有 share 信息
   - 等过期后访问 → 返回 410 Gone（同时前端显示"已失效"）
   - 重启 gateway 后永久链接仍有效
