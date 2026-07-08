# Artifact Share Link Feature
> 待实现

## Context

nanobot 的 Artifact 文件（存储在 `outputs_{session}` 目录中）目前只能在右侧抽屉面板中预览。用户希望能生成一个可直接在浏览器中打开的链接，类似分享功能，让文件可以被外部访问或在其他标签页中查看。

当前系统已有 HMAC 签名的 media URL 机制（`/api/media/{sig}/{payload}`），用于图片/视频的内联展示。本方案复用该模式，扩展为支持工作区文件的可过期签名分享链接。

## Design

### Backend

#### 0. Persistent gateway signing secret

**`nanobot/config/gateway_secret.py`** — 新增模块

引入 gateway 级别的持久签名密钥 `gateway_secret`，不仅限于 artifact share，未来任何需要跨重启持久化签名的功能均可复用。

- 文件路径: `~/.nanobot/data/gateway_secret`（一行 base64 编码的 32 字节随机数据）
- 首次启动时: `secrets.token_bytes(32)` → base64 → 写入文件
- 后续启动时: 直接读取文件内容 → base64 decode
- 文件权限: `0o600`（仅 owner 可读写）
- 与 media secret 分离 — media secret 仍为 per-startup（图片 URL 嵌在消息中，重启后重新生成合理）

```python
def load_or_create_gateway_secret() -> bytes:
    """Load persistent signing secret from disk, or create it on first run."""
```

#### 1. New module: `nanobot/webui/artifact_share.py`

核心签名/验证逻辑，复用 `media_api.py` 的 b64url 编解码和 HMAC 模式。

**签名 payload 格式**（base64url-encoded JSON）:
```json
{
  "p": "outputs_websocket_abc123/report.md",  // 相对于 workspace 的路径
  "e": 1719936000,                              // 过期时间 (Unix timestamp), 0 = 永久
  "n": "report.md"                              // 原始文件名（用于 Content-Disposition）
}
```

**Key functions:**

- `sign_artifact_path(abs_path, workspace_path, secret, expires_at, filename)` → `/api/artifacts/{sig}/{payload}`
  - 验证路径在 workspace 内
  - 构建 JSON payload → b64url encode → HMAC-SHA256 签名（取前 16 字节）
  - `expires_at=0` 表示永不过期
  - 返回签名 URL 路径

- `serve_signed_artifact(sig, payload, secret, workspace_path, request)` → `Response`
  - 验证 HMAC 签名
  - 检查过期时间（`e=0` 时跳过）
  - 验证路径在 workspace 边界内（二次校验，防符号链接逃逸）
  - 推断 MIME 类型，设置 `Content-Disposition: inline`
  - 对 HTML/SVG 设置 restrictive CSP
  - 支持 HTTP byte ranges（复用 `_parse_single_byte_range`）
  - 过期返回 410 Gone，签名无效返回 401

- `ARTIFACT_INLINE_MIMES`: 允许的 inline MIME 类型白名单（image/*, text/*, application/pdf, application/json, video/* 等），不在白名单中的降级为 `application/octet-stream`（触发下载而非 inline）

- **有效期选项**（前端 → 后端的 `expires_in` 值映射）:
  | 选项 | expires_in (秒) | 说明 |
  |------|----------------|------|
  | 1 天 | 86400 | 临时分享 |
  | 7 天 | 604800 | 短期分享 |
  | 永久 | 0 | 直到文件被删除或 gateway_secret 被手动重置 |

- **永久链接说明**: "永久"指链接无过期时间。签名密钥 `gateway_secret` 持久化在磁盘上，跨 gateway 重启保持不变。"永久"链接在以下情况下失效：文件被删除、gateway_secret 被手动删除/重置。

#### 2. Gateway 集成

**`nanobot/webui/media_gateway.py`** — `WebUIMediaGateway` 扩展:
- 添加 `artifact_secret: bytes` 构造参数（从 `gateway_secret` 加载）
- 添加 `sign_artifact_path(path, expires_at, filename)` 方法 — 使用 `self.artifact_secret` 签名
- 添加 `serve_signed_artifact(sig, payload, request)` 方法 — 使用 `self.artifact_secret` 验证
- media secret（`self.secret`）保持 per-startup 不变

**`nanobot/webui/gateway_services.py`** — `build_gateway_services()` 更新:
- 调用 `load_or_create_gateway_secret()` 获取持久 secret
- 传入 `WebUIMediaGateway` 的 `artifact_secret` 参数

**`nanobot/webui/ws_http.py`** — `GatewayHTTPHandler` 路由:

- **`_dispatch_media_routes`** 中新增:
  ```python
  m = re.match(r"^/api/artifacts/([A-Za-z0-9_-]+)/([A-Za-z0-9_-]+)$", got)
  if m:
      return self._handle_artifact_fetch(m.group(1), m.group(2), request)
  ```
  - `_handle_artifact_fetch` 调用 `self.media.serve_signed_artifact()`
  - **无需 API token**（签名即授权）

- **`_dispatch_session_routes`** 中新增:
  ```python
  m = re.match(r"^/api/sessions/([^/]+)/artifact-share$", got)
  if m:
      return self._handle_artifact_share(request, m.group(1))
  ```
  - 需要 API token
  - 接收 POST JSON: `{"path": "...", "expires_in": 86400}`
  - `expires_in` 允许值: `86400`（1天）、`604800`（7天）、`0`（永久），其他值拒绝
  - 通过 workspace scope 解析路径
  - 验证路径在 `outputs_` 目录内（或至少 workspace 内）
  - 返回: `{"url": "/api/artifacts/...", "expires_at": 1719936000, "filename": "report.md"}`

#### 3. Security considerations

| Threat | Mitigation |
|--------|-----------|
| Path traversal | `resolve_allowed_path(strict=True)` + 签名时存储相对路径 + 服务时二次验证 |
| 链接过期 | payload 中包含 `exp` 时间戳，服务时检查，`e=0` 表示不过期 |
| 签名伪造 | HMAC-SHA256，16 字节 MAC，timing-safe compare |
| XSS via HTML | HTML 文件 serve 时设置 `Content-Security-Policy: sandbox; default-src 'self' 'unsafe-inline' data: blob:` |
| XSS via SVG | 复用 media_api 的 SVG CSP: `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| 链接被暴力枚举 | URL 路径格式 `/api/artifacts/{sig}/{payload}`，sig 为 16 字节 HMAC，不可枚举 |
| Secret 泄露 | `gateway_secret` 持久化在 `~/.nanobot/data/gateway_secret`，权限 `0o600`；手动删除该文件可立即失效所有已生成链接 |
| 大文件 DoS | byte range 支持 + 不缓存大文件 |
| expires_in 滥用 | 后端白名单校验仅允许 0/86400/604800 |

### Frontend

#### 4. API function

**`webui/src/lib/api.ts`** — 新增:
```typescript
async function createArtifactShare(
  token: string,
  sessionKey: string,
  path: string,
  expiresIn: number,  // 0 | 86400 | 604800
): Promise<{ url: string; expires_at: number; filename: string }>
```

#### 5. Share button component

**`webui/src/components/ArtifactShareButton.tsx`** — 新组件:
- Props: `token, sessionKey, filePath, variant?: "icon" | "menu-item"`
- 点击后弹出小 popover 选择有效期: **1 天 / 7 天 / 永久**
- 调用 `createArtifactShare()`，构造完整 URL（`window.location.origin + response.url`）
- 自动复制到剪贴板（使用 `@/lib/clipboard.ts` 的 `copyTextToClipboard`）
- Copy → Check 动画反馈（复用 `LinkPreviewDrawer` 的模式）
- Popover 内显示生成的链接（可手动复制）

#### 6. 集成到现有 toolbar

在以下位置添加 Share 按钮（使用 `Share2` icon from lucide-react）:

- **`FileFullscreenPreview.tsx`** — toolbar Actions 区域，Copy 和 Download 按钮旁边
- **`SessionDrawer.tsx`** FilesTab toolbar — Copy 和 Download 按钮旁边
- **`FilePreviewPanel.tsx`** — 在 breadcrumb bar 右侧添加 Share 按钮

按钮仅在文件路径包含 `outputs_` 时显示（即只分享 artifact 输出文件）。

#### 7. i18n

**`webui/src/locales/en/common.json`** + **`webui/src/locales/zh-CN/common.json`**:
- `artifact.share`: "Share" / "分享"
- `artifact.share.copyLink`: "Copy link" / "复制链接"
- `artifact.share.copied`: "Link copied" / "链接已复制"
- `artifact.share.expiresIn`: "Expires in" / "有效期"
- `artifact.share.1d`: "1 day" / "1 天"
- `artifact.share.7d`: "7 days" / "7 天"
- `artifact.share.permanent`: "Permanent" / "永久"

## Files to modify

### Backend (Python)
| File | Change |
|------|--------|
| `nanobot/config/gateway_secret.py` | **NEW** — 持久签名密钥加载/创建逻辑 |
| `nanobot/webui/artifact_share.py` | **NEW** — 签名、验证、服务逻辑 |
| `nanobot/webui/media_gateway.py` | 添加 `artifact_secret` 参数 + artifact share 方法 |
| `nanobot/webui/gateway_services.py` | 调用 `load_or_create_gateway_secret()` 并传入 media gateway |
| `nanobot/webui/ws_http.py` | 添加 2 个路由: share 生成 + artifact 服务 |

### Frontend (TypeScript/React)
| File | Change |
|------|--------|
| `webui/src/lib/api.ts` | 添加 `createArtifactShare()` |
| `webui/src/components/ArtifactShareButton.tsx` | **NEW** — Share 按钮组件 |
| `webui/src/components/FileFullscreenPreview.tsx` | 添加 Share 按钮 |
| `webui/src/components/thread/SessionDrawer.tsx` | 添加 Share 按钮 |
| `webui/src/components/FilePreviewPanel.tsx` | 添加 Share 按钮（仅 outputs 文件） |
| `webui/src/locales/en/common.json` | 添加 i18n keys |
| `webui/src/locales/zh-CN/common.json` | 添加 i18n keys |

### Tests
| File | Change |
|------|--------|
| `tests/webui/test_artifact_share.py` | **NEW** — 签名/验证/过期/安全测试 |

## Verification

1. **Unit tests**: `pytest tests/webui/test_artifact_share.py -v`
   - 签名生成和验证
   - 过期链接返回 410 Gone
   - 永久链接不过期
   - 路径越界拒绝
   - 签名篡改返回 401
   - HTML/SVG CSP headers 正确
   - 非法 expires_in 拒绝

2. **Integration test**: 启动 gateway，创建 share 链接，用 curl 直接访问（不带 token），验证文件内容返回

3. **Frontend test**: `cd webui && bun run test`
   - Share 按钮渲染
   - Popover 交互

4. **Manual E2E**:
   - 打开 WebUI → 在 session 的 outputs 目录中选择一个文件
   - 点击 Share 按钮 → 选择有效期 → 复制链接
   - 在新标签页中打开链接 → 文件正确渲染（inline）
   - 等过期后访问 → 返回 410 Gone
   - 选择"永久"→ 链接不过期，重启 gateway 后仍有效
   - 手动删除 `~/.nanobot/data/gateway_secret` → 重启后链接失效（secret 重新生成）
