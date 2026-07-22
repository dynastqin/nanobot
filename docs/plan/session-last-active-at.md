# 执行计划：分离「用户活跃时间」与「系统维护时间」

## 问题

`Session.updated_at` 承担了双重职责：
1. **用户排序** — WebUI 用它决定聊天列表的顺序
2. **系统判断** — AutoCompact 用它判断 session 是否空闲过期

当 `compact_idle_session()` (memory.py) 对空闲 session 做后台压缩时，把 `updated_at` 刷新为当前时间，导致已沉底的旧聊天意外跳到列表最前面，用户困惑。

## 方案

引入新字段 `last_active_at`，职责分离：

| 字段 | 更新时机 | 用途 |
|------|---------|------|
| `last_active_at` | 仅 `add_message()` | WebUI 排序 |
| `updated_at` | 任何变更（不变） | AutoCompact 空闲判断、session 元数据 |

## 涉及文件

```
nanobot/
├── nanobot/session/manager.py            ← Session 模型 + 持久化 + 读写 API
├── nanobot/webui/session_list_index.py   ← WebUI 侧边栏索引缓存（主要数据源）
├── nanobot/agent/memory.py               ← compact_idle_session 移除多余更新 + _last_summary 改用 last_active_at
├── nanobot/agent/loop.py                 ← _save_turn 保留 updated_at 更新
├── webui/src/lib/api.ts                  ← 前端 Row 类型 + map
├── webui/src/lib/types.ts                ← ChatSummary 接口
├── webui/src/lib/chat-groups.ts          ← 排序改用 lastActiveAt（4 处）
└── webui/src/components/ChatList.tsx      ← 展示时间改用 lastActiveAt（2 处）
```

## 详细步骤

### 步骤 1：Session 模型新增 `last_active_at` 字段

**文件**: `nanobot/session/manager.py`

**1a. Session dataclass** (行 102-111) — 新增字段：
```python
@dataclass
class Session:
    key: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    last_active_at: datetime | None = None  # 新增：用户最后活跃时间，仅 add_message() 更新
    metadata: dict[str, Any] = field(default_factory=dict)
    last_consolidated: int = 0
```

**1b. `add_message()`** (行 141-150) — 同步更新 `last_active_at`：
```python
def add_message(self, role: str, content: str, **kwargs: Any) -> None:
    msg = {"role": role, "content": content, "timestamp": datetime.now().isoformat(), **kwargs}
    self.messages.append(msg)
    self.updated_at = datetime.now()
    self.last_active_at = datetime.now()  # 新增
```

### 步骤 2：持久化读写 `last_active_at`

**文件**: `nanobot/session/manager.py`

**2a. `save()`** (行 592-599) — metadata_line 新增字段：
```python
metadata_line = {
    "_type": "metadata",
    "key": session.key,
    "created_at": session.created_at.isoformat(),
    "updated_at": session.updated_at.isoformat(),
    "last_active_at": session.last_active_at.isoformat() if session.last_active_at else None,
    "metadata": session.metadata,
    "last_consolidated": session.last_consolidated,
}
```

**2b. `_load()`** (行 459-510) — 读取新字段：
- 在变量声明区新增 `last_active_at = None`
- 在 metadata 行解析中读取 `la_raw = data.get("last_active_at")`，若存在则 `last_active_at = datetime.fromisoformat(la_raw)`
- 在 `return Session(...)` 中传入 `last_active_at=last_active_at`

**2c. `_repair()`** (行 512-562) — 同上逻辑，在变量声明区和 return 中增加 `last_active_at`。

**2d. `_session_payload()`** (行 568-575) — 新增字段：
```python
return {
    "key": session.key,
    "created_at": session.created_at.isoformat(),
    "updated_at": session.updated_at.isoformat(),
    "last_active_at": session.last_active_at.isoformat() if session.last_active_at else None,
    "metadata": session.metadata,
    "messages": session.messages,
}
```

**2e. `read_session_file()`** (行 726-763) — 声明区新增 `last_active_at: str | None = None`，metadata 解析中读取 `data.get("last_active_at")`，返回 dict 中新增 `"last_active_at": last_active_at`。

**2f. `read_session_metadata()`** (行 772-809) — 返回 dict 中新增 `"last_active_at": data.get("last_active_at")`。repaired 分支同样新增。

**2g. `list_sessions()`** (行 858-866) — 正常路径 dict 中新增 `"last_active_at": data.get("last_active_at")`。

**2h. `list_sessions()` repaired 分支** (行 870-887) — 新增 `"last_active_at": repaired.last_active_at.isoformat() if repaired.last_active_at else None`。

**2i. `fork_session_before_user_index()`** (行 714-722) — Session 构造中显式设置 `last_active_at=None`（fork 不是用户活动）。

### 步骤 3：WebUI 侧边栏索引缓存适配

**文件**: `nanobot/webui/session_list_index.py`

这是 WebUI 会话列表的**实际数据源**（`list_webui_sessions()`），不是 `manager.py:list_sessions()`。

**3a. `_public_row()`** (行 132-140) — 新增 `last_active_at`：
```python
def _public_row(sessions_dir: Path, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": row.get("key"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "last_active_at": row.get("last_active_at"),  # 新增
        "title": row.get("title", ""),
        "preview": row.get("preview", ""),
        "path": str(sessions_dir / str(row.get("file", ""))),
    }
```

**3b. `_scan_session_row()`** (行 250-259) — 返回 dict 中新增 `"last_active_at": data.get("last_active_at")`。

**3c. `_indexed_row_for_session()`** (行 197-207) — 返回 dict 中新增 `"last_active_at": session.last_active_at.isoformat() if session.last_active_at else None`。

**3d. `_indexed_row_matches_file()`** (行 112-129) — 在有效性检查中新增 `last_active_at` 验证，确保旧缓存（无此字段）自动失效：
```python
if not isinstance(row.get("last_active_at"), (str, type(None))):
    return False
```

**3e. `list_webui_sessions()`** (行 43) — 排序改用 `last_active_at`，fallback 到 `updated_at`：
```python
return sorted(sessions, key=lambda row: row.get("last_active_at") or row.get("updated_at", ""), reverse=True)
```

### 步骤 4：API 返回 `last_active_at`

**文件**: `nanobot/webui/ws_http.py` — `_sessions_list_payload()` (行 432)

`row = {k: v for k, v in s.items() if k != "path"}` 已自动透传 `last_active_at`，无需改动。

### 步骤 5：移除 compact_idle_session 中对 `updated_at` 的多余更新

**文件**: `nanobot/agent/memory.py` (行 992-1063)

三处 `session.updated_at = datetime.now()` 全部删除：

| 行号 | 场景 | 操作 |
|------|------|------|
| 1011 | 无消息可压缩 | 删除 `session.updated_at = datetime.now()` |
| 1028 | 无消息移除/保留 | 删除 `session.updated_at = datetime.now()` |
| 1051 | 正常压缩完成 | 删除 `session.updated_at = datetime.now()` |

> **注意**: 保留 `save()` 调用。`updated_at` 不再刷新意味着 session 在 TTL 检查中持续"过期"，下次 `check_expired` 会再次尝试压缩，但消息已被截断至 8 条，`compact_idle_session` 会快速返回 `""`（无消息可移除），开销极小。

**5b. `_persist_last_summary()`** (行 784-790) — `last_active` 改用 `last_active_at`：
```python
last_active = session.last_active_at or session.updated_at
session.metadata["_last_summary"] = {
    "text": summary,
    "last_active": last_active.isoformat(),
}
```

**5c. `compact_idle_session()` 行 1032** — 同上：
```python
last_active = session.last_active_at or session.updated_at
```

### 步骤 6：loop.py 保持不变

**文件**: `nanobot/agent/loop.py`

- 行 1779 (`_save_turn`): `session.updated_at = datetime.now()` — 保留，用户交互回写
- 行 1901 (`_restore_pending_user_turn`): `session.updated_at = datetime.now()` — 保留，用户交互回写

这两处都是用户触发的操作，AutoCompact 需要 `updated_at` 反映这些变更。

### 步骤 7：前端适配

**7a. `webui/src/lib/types.ts`** — `ChatSummary` 接口新增字段：
```typescript
export interface ChatSummary {
  key: string;
  channel: string;
  chatId: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActiveAt: string | null;  // 新增
  title?: string;
  preview: string;
  runStartedAt?: number | null;
  workspaceScope?: WorkspaceScopePayload | null;
  folderId?: string | null;
}
```

**7b. `webui/src/lib/api.ts`** (行 107-133) — Row 类型 + map 新增：
```typescript
type Row = {
    key: string;
    created_at: string | null;
    updated_at: string | null;
    last_active_at: string | null;  // 新增
    // ...
};
// map 中新增:
lastActiveAt: s.last_active_at ?? s.updated_at,  // 兼容旧数据
```

**7c. `webui/src/lib/chat-groups.ts`** — 4 处排序改用 `lastActiveAt`：

| 行号 | 当前代码 | 改为 |
|------|---------|------|
| 270 | `session.updatedAt ?? session.createdAt` | `session.lastActiveAt ?? session.updatedAt ?? session.createdAt` |
| 297 | `s.updatedAt ?? s.createdAt` | `s.lastActiveAt ?? s.updatedAt ?? s.createdAt` |
| 459 | `sessionTime(b, "updatedAt")` | `sessionTime(b, "lastActiveAt")` |
| 461 | `sessionTime(b, sort === "created_desc" ? "createdAt" : "updatedAt")` | `sessionTime(b, sort === "created_desc" ? "createdAt" : "lastActiveAt")` |

> 注意：`sessionTime()` 函数通过 `session[field]` 动态取值，传入 `"lastActiveAt"` 即可工作。`lastActiveAt` 可能为 `null`（旧数据），`Date.parse(null ?? "")` 返回 `NaN`，`Number.isFinite(NaN)` 为 `false`，返回 0 — 旧数据会排在最后，行为正确。

**7d. `webui/src/components/ChatList.tsx`** — 2 处：

| 行号 | 当前代码 | 改为 |
|------|---------|------|
| 305 | `relativeTime(s.updatedAt ?? s.createdAt)` | `relativeTime(s.lastActiveAt ?? s.updatedAt ?? s.createdAt)` |
| 546 | `updatedAt={showTimestamps ? group.updatedAt : null}` | 保持不变 — group 级别的 `updatedAt` 来自 bucket 聚合（`chat-groups.ts` 行 270/297），那两处改后自动生效 |

### 步骤 8：兼容性处理

- **旧 session 文件没有 `last_active_at`** → 所有读取路径将其设为 `None`/`null`，前端 fallback 链 `lastActiveAt ?? updatedAt ?? createdAt` 保证正常排序。
- **`.webui_session_index.json` 缓存** → `_indexed_row_matches_file()` 检查 `last_active_at` 类型，旧缓存行（无此字段）自动失效并重新扫描，无需手动清缓存。
- **`updated_at` 保持不变** → AutoCompact 的 `_is_expired()` 继续用 `updated_at` 判断空闲时间，不受影响。

## 不改动的点

| 位置 | 理由 |
|------|------|
| `flush_all()` — manager.py:626 | 只用 `save()` 写回现有值，不更新任何时间戳 |
| `maybe_generate_webui_title()` — webui_turns.py | 写 title metadata 不调用 `add_message()`，不会触发 `last_active_at` 更新 |
| AutoCompact `check_expired()` — autocompact.py:45 | 判断逻辑继续用 `updated_at` |
| `loop.py` `_save_turn()` / `_restore_pending_user_turn()` | 用户交互回写，`updated_at` 应更新 |
| `loop.py` `_restore_runtime_checkpoint()` | 崩溃恢复场景，`updated_at` 合理更新 |

## 验证要点

1. 用户发送消息后，聊天排到列表最前面
2. AutoCompact 压缩空闲 session 后，该聊天**不**跳到最前面
3. 实例重启 (`nanobotx restart`) 后，排序不变
4. 旧 session（无 `last_active_at` 字段）正常降级显示
5. `updated_at` 持续更新，AutoCompact 空闲判断正常触发
6. WebUI 侧边栏索引缓存 (`.webui_session_index.json`) 自动失效重建
7. Fork 出的新 session 不会继承源 session 的 `last_active_at`
8. `_last_summary` 中的 `last_active` 时间戳反映用户真实最后活跃时间
