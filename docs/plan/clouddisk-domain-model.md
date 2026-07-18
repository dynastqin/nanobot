# CloudDisk 领域模型

> nanobot 框架级功能：实例级云盘，支持 chat 文件保存/选择，media 目录合并。
> 36 轮决策产出，2026-07-18。

## 1. 限界上下文

```
┌──────────────────────────────────────────────────────┐
│                    nanobot Instance                   │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Agent Tools │  │  CloudDisk   │  │   WebUI    │  │
│  │ (disk param)│──│  Storage     │──│  CloudDisk │  │
│  │             │  │  (filesystem)│  │  Tab +     │  │
│  │ read/write  │  │              │  │  Selector  │  │
│  │ edit/list   │  │ .meta.json   │  │  + Save    │  │
│  │ apply_patch │  │ quota check  │  │  Button    │  │
│  └─────────────┘  └──────┬───────┘  └─────┬──────┘  │
│                          │                 │         │
│                    ┌─────┴─────┐    ┌──────┴──────┐ │
│                    │ CloudDisk │    │  Media      │ │
│                    │   API     │    │  Gateway    │ │
│                    │ REST CRUD │    │ Signed URLs │ │
│                    └───────────┘    └─────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              Session Context                  │    │
│  │  workspace/  ←→  clouddisk/                  │    │
│  │  (暂存, 会话隔离)    (持久, 实例内共享)         │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

### 上下文职责

| 上下文 | 职责 | 关键文件 |
|--------|------|---------|
| **CloudDisk Storage** | 文件持久化、元数据索引、配额管理 | `nanobot/clouddisk/` (新增) |
| **CloudDisk API** | REST 端点：list/upload/download/delete/move/info/quota | `nanobot/webui/clouddisk_api.py` (新增) |
| **CloudDisk UI** | WebUI 云盘 Tab、文件选择器、保存按钮 | `webui/src/components/CloudDisk/` (新增) |
| **Agent Tools** | 文件工具扩展 disk 参数，路由到 workspace 或 clouddisk | `nanobot/agent/tools/filesystem.py` (改造) |
| **Media Gateway** | 签名 URL 机制扩展支持 clouddisk 文件预览 | `nanobot/webui/media_api.py` (改造) |
| **Config** | CloudDiskConfig Pydantic 模型 | `nanobot/config/schema.py` (改造) |

## 2. 实体关系图

```
Instance (1) ────< (1) CloudDisk
                          │
                          ├── (1) MetaIndex (.meta.json)
                          │       │
                          │       └── (*) FileMetadata
                          │              ├── name: str
                          │              ├── size: int (bytes)
                          │              ├── type: str (MIME)
                          │              ├── created_at: datetime
                          │              └── source_session_id: str?
                          │
                          ├── (*) CloudDiskFolder
                          │       │
                          │       └── (*) CloudDiskFile
                          │              └── content: bytes
                          │
                          └── (1) ChatArchive (聊天归档/)
                                  │
                                  └── (*) SessionArchive (<session-id>/)
                                          │
                                          └── (*) CloudDiskFile (auto-archived media)

Session (*) ──── source_session_id ──── (*) CloudDiskFile
```

## 3. 核心流程

### 3.1 文件进入云盘的三条路径

```
路径 A: Agent 工具写入
  用户: "帮我把这个报告保存到云盘"
  Agent: write_file(path="report.md", content="...", disk="cloud")
  → CloudDisk Storage 写入 clouddisk/report.md
  → 更新 .meta.json

路径 B: WebUI 上传
  用户: 在云盘 Tab 点击"上传"按钮
  → CloudDisk API POST /api/clouddisk/upload
  → CloudDisk Storage 写入文件
  → 更新 .meta.json

路径 C: 从 Chat 保存
  用户: 点击消息气泡中的"保存到云盘"
  → CloudDisk API: 复制 workspace 文件到 clouddisk 目标路径
  → 文件名冲突 → 弹窗确认
  → 更新 .meta.json

路径 D: Session 自动归档
  Session 中产生媒体文件
  → Media Gateway 实时写入 clouddisk/聊天归档/<session-id>/
  → 更新 .meta.json (source_session_id 非空)
```

### 3.2 文件从云盘进入 Chat

```
用户在 chat 输入框点击"附件"按钮
  → 弹出 FileSelector
  → GET /api/clouddisk/list?path=/&recursive=false
  → 用户浏览目录树，选中文件
  → 小文件 (<100KB): 内容自动注入到用户消息 context
  → 大文件 (≥100KB): 注入文件引用消息 (路径 + 元数据)
  → Agent 收到消息后自行调用 read_file(disk="cloud") 按需读取
```

### 3.3 Agent 工具路由

```
read_file(path="report.md", disk="cloud")
  → _FsTool._resolve_path()
    ├── disk="workspace" → <workspace_root>/report.md
    └── disk="cloud"    → <instance>/clouddisk/report.md
  → 路径边界校验 (workspace_policy)
  → 读取文件内容
```

## 4. API 设计

| 端点 | 方法 | 请求 | 响应 | 说明 |
|------|------|------|------|------|
| `/api/clouddisk/list` | GET | `?path=/&recursive=false` | `{folders: [...], files: [{name, size, type, created_at}]}` | 列出目录内容 |
| `/api/clouddisk/upload` | POST | multipart: `file` + `path` | `{path, size, type, created_at}` | 上传文件 |
| `/api/clouddisk/download` | GET | `?path=...` | 文件流 (Content-Disposition: attachment) | 下载文件 |
| `/api/clouddisk/delete` | POST | `{"path": "..."}` | `{ok: true}` | 删除文件或空文件夹 |
| `/api/clouddisk/move` | POST | `{"from": "...", "to": "..."}` | `{ok: true, path: "..."}` | 移动/重命名 |
| `/api/clouddisk/info` | GET | `?path=...` | `{name, size, type, created_at, source_session_id}` | 文件元数据 |
| `/api/clouddisk/quota` | GET | - | `{used_mb, quota_mb, percent}` | 配额使用情况 |

## 5. 配置模型

```python
# nanobot/config/schema.py

class CloudDiskConfig(Base):
    enabled: bool = True
    root_dir: str = "clouddisk/"    # 相对于 instance 目录
    quota_mb: int = 10240           # 软配额，超限提醒不禁写
```

```json
// instances/<name>/config.json
{
  "clouddisk": {
    "enabled": true,
    "root_dir": "clouddisk/",
    "quota_mb": 10240
  }
}
```

## 6. 文件系统布局

```
instances/<name>/
├── clouddisk/                     # 新增：云盘根目录
│   ├── .meta.json                 # 元数据索引
│   ├── 聊天归档/                   # 预建：session 自动归档
│   │   └── <session-id>/          # 自动创建：某次对话的媒体文件
│   │       ├── image_001.png
│   │       └── chart_002.png
│   └── <用户创建的文件夹>/
│       └── <用户上传/保存的文件>
├── workspace/                     # 不变：agent 工作区
├── webui/                         # 不变：WebUI 状态
├── config.json                    # 改造：新增 clouddisk 段
└── ...
```

## 7. 工具参数变更

```python
# disk 参数定义
DiskTarget = Literal["workspace", "cloud"]

# 所有文件工具新增参数
class ReadFileArgs(BaseModel):
    path: str
    disk: DiskTarget = "workspace"
    # ... 其他参数不变

class WriteFileArgs(BaseModel):
    path: str
    content: str
    disk: DiskTarget = "workspace"

class EditFileArgs(BaseModel):
    path: str
    old_text: str
    new_text: str
    disk: DiskTarget = "workspace"
    # ...

class ListDirArgs(BaseModel):
    path: str
    disk: DiskTarget = "workspace"
    recursive: bool = False

class ApplyPatchArgs(BaseModel):
    path: str
    patch: str
    disk: DiskTarget = "workspace"
```

## 8. WebUI 组件树

```
App
├── Sidebar
│   ├── SessionsList        (现有)
│   ├── Settings             (现有)
│   ├── Skills               (现有)
│   └── CloudDiskTab  ← NEW  (一级导航)
│
├── CloudDiskPage    ← NEW
│   ├── FolderTree           (左侧目录树)
│   │   ├── 聊天归档/
│   │   │   └── <session-id>/
│   │   └── <用户文件夹>/
│   └── FileList             (右侧文件列表)
│       ├── ViewToggle       (列表/网格切换)
│       ├── UploadButton     (上传按钮)
│       ├── FileRow/FileCard (文件条目)
│       │   └── ContextMenu  (下载/删除/重命名/移动)
│       └── QuotaBar         (配额使用条)
│
├── ChatView
│   ├── MessageBubble
│   │   └── SaveToCloudDiskButton  ← NEW  (文件引用旁)
│   ├── FilePreviewPanel
│   │   └── SaveToCloudDiskButton  ← NEW  (面板工具栏)
│   └── ChatInput
│       └── AttachmentButton
│           └── FileSelector ← NEW  (云盘文件选择器弹窗)
```

## 9. 安全模型

| 层 | 策略 |
|----|------|
| **API 层** | CloudDisk API 端点需要 WebSocket token 鉴权（与现有 API 一致） |
| **Agent 工具层** | `disk="cloud"` 时路径边界切换到 `clouddisk/` 根目录，使用现有 `workspace_policy.resolve_allowed_path()` 机制 |
| **文件服务层** | 签名 URL 覆盖 CloudDisk 预览场景（Tab 内图片/视频），chat 引用走 `file-preview` API |
| **类型限制** | 无限制（用户可选任意类型），但 `file-preview` API 仅对文本类型返回内容；二进制文件走签名 URL 或下载 |

## 10. Agent Prompt 注入

在 `AGENTS.md` 模板中新增云盘使用说明：

```markdown
## CloudDisk (云盘)

You have access to a CloudDisk for persistent file storage shared across all sessions in this instance.

### When to use cloud disk
- User explicitly mentions "cloud disk", "云盘", "save to cloud", "保存到云盘"
- User asks you to read a file they uploaded to the cloud disk
- User wants files to persist beyond the current session

### How to use
Add `disk="cloud"` to any file tool:
- `read_file(path="report.md", disk="cloud")`
- `write_file(path="report.md", content="...", disk="cloud")`
- `list_dir(path="/", disk="cloud")`

Default `disk="workspace"` — only switch when the user's intent is clear.
```
