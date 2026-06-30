# Per-Session Outputs Directories

## Context

目前 agent 把所有聊天产出文件写到 `workspace/outputs/`，跨会话混在一起。用户希望每个会话有独立的 `outputs_{session_id}/` 目录，WebUI 里每个会话只看到自己的产出文件。skills 目录保持跨会话共享。

目标：
- 每个会话写入 `workspace/outputs_{session_id}/`（session_id 由 session_key 清洗而来）
- subagent 产出写入**父会话**的 outputs 目录
- WebUI SessionDrawer 文件树只展示 `skills/` + 当前会话的 `outputs_{session_id}/`
- 隐藏旧的 `workspace/outputs/` 目录（磁盘上保留但不再展示）
- 所有渠道（WebUI、Telegram、Discord 等）统一启用

session_key 形如 `websocket:abc123` 或 `telegram:12345`，含 `:` 不能直接做目录名 — 用 `nanobot/utils/helpers.py:274` 已有的 `safe_filename()` 清洗成 `websocket_abc123`。

## 改动清单

### 1. 新增辅助函数 — `nanobot/utils/helpers.py`

在 `safe_filename` 附近新增：

```python
def outputs_dir_for_session(session_key: str | None) -> str:
    """Return the per-session outputs directory name (relative to workspace root).

    Sanitizes the session_key so characters like ':' (unsafe in directory names
    on Windows / shown as '/' in macOS Finder) are replaced with '_'.
    Falls back to 'outputs_default' when session_key is missing.
    """
    if not session_key:
        return "outputs_default"
    return f"outputs_{safe_filename(session_key)}"
```

同时把 `helpers.py:716` 的 `(workspace / "outputs").mkdir(exist_ok=True)` 删掉 — 不再预创建统一 outputs 目录（per-session 目录由 agent 写文件时自然创建）。

### 2. Agent 主提示词 — `nanobot/agent/context.py` + `nanobot/templates/agent/identity.md`

**`context.py`**：
- `_get_identity(self, channel, workspace, session_key=None)` — 新增 `session_key` 参数（当前签名在 `context.py:119`）
- 计算 `outputs_dir = outputs_dir_for_session(session_key)` 并作为模板变量传入 `render_template`
- `build_system_prompt` 在 `context.py:78` 调用 `_get_identity` 时把已有的 `session_key` 参数透传下去（`build_system_prompt` 签名 `context.py:66` 已有 `session_key`）

**`templates/agent/identity.md:9`** 改为：
```markdown
- Generated/output files: {{ workspace_path }}/{{ outputs_dir }}/ — always save code, documents, images, and any generated files here. Do not write generated files directly to the workspace root.
```

### 3. Subagent 提示词 — `nanobot/agent/subagent.py` + `nanobot/templates/agent/subagent_system.md`

**`subagent.py`**：
- `_build_subagent_prompt(self, workspace=None, session_key=None)` — 新增 `session_key` 参数（当前签名 `subagent.py:356`）
- 计算 `outputs_dir = outputs_dir_for_session(session_key)` 传入模板
- `_run_subagent` 在 `subagent.py:229` 调用 `_build_subagent_prompt` 时，传入 `session_key=origin.get("session_key")`（父会话 key，subagent.py:235 已有该取值，只需把顺序提前或在调用时取）

**`templates/agent/subagent_system.md:12`** 改为：
```markdown
- Save generated/output files into {{ outputs_dir }}/ subdirectory.
```

### 4. WebUI 文件列表过滤 — `nanobot/webui/workspace_files.py`

当前 `_ROOT_DIRS = frozenset({"skills", "outputs"})` 只允许这两个根目录被列出（`workspace_files.py:16, 47`）。

改动：
- 移除模块级 `_ROOT_DIRS` 常量，改为 `list_workspace_files(scope, subpath=".", session_key=None)` 接受 `session_key` 参数
- 在 `_build_tree` 中把 `depth == 0` 的根目录过滤改成：允许 `skills` + 当前会话的 `outputs_{session_id}`（由 `outputs_dir_for_session(session_key)` 计算）。不再展示 `outputs` 和其他会话的 `outputs_*`
- 因为 `_build_tree` 是内部递归函数，需要把当前会话允许的 outputs 目录名传进去（参数或闭包）

### 5. WebUI 路由透传 session_key — `nanobot/webui/ws_http.py:532`

`_handle_workspace_files` 已经有 `decoded_key`（解码后的 session_key）。在调用 `list_workspace_files`（`ws_http.py:542`）时加上 `session_key=decoded_key`。

### 6. 前端：无需改动

`SessionDrawer.tsx` 已经用 `sessionKey` 拉文件树（`SessionDrawer.tsx:208, 298`），`fetchWorkspaceFiles(token, sessionKey)` 已经把 sessionKey 编码进 URL（`api.ts:221`）。后端按 session_key 过滤后，前端天然只看到当前会话的 outputs。

`ThreadShell.tsx:626-633` 的相对路径归一化（把 `outputs_xxx/foo.txt` 拼到 workspace 根）对 per-session 目录同样有效，无需改动。

## 关键文件清单

| 文件 | 改动 |
|------|------|
| `nanobot/utils/helpers.py` | 新增 `outputs_dir_for_session()`；删除 `outputs` 目录预创建（line 716）|
| `nanobot/agent/context.py` | `_get_identity` 接收并传 `outputs_dir` 到模板（line 119-132）；`build_system_prompt` 透传 `session_key`（line 78）|
| `nanobot/templates/agent/identity.md` | line 9 改用 `{{ outputs_dir }}` |
| `nanobot/agent/subagent.py` | `_build_subagent_prompt` 接收 `session_key`（line 356）；`_run_subagent` 调用处传父 session_key（line 229）|
| `nanobot/templates/agent/subagent_system.md` | line 12 改用 `{{ outputs_dir }}` |
| `nanobot/webui/workspace_files.py` | `list_workspace_files` 接收 `session_key`，根目录过滤改为 `skills` + 当前会话 `outputs_*` |
| `nanobot/webui/ws_http.py` | `_handle_workspace_files` 把 `decoded_key` 传给 `list_workspace_files`（line 542）|

## 复用的现有工具

- `safe_filename()` — `nanobot/utils/helpers.py:274` — 清洗 session_key 中的不安全字符
- `render_template()` — `nanobot/utils/prompt_templates.py:28` — 渲染 identity/subagent 模板
- `fetchWorkspaceFiles()` — `webui/src/lib/api.ts:221` — 前端已按 sessionKey 拉取，无需改动

## 验证

1. **启动 gateway + WebUI**：`nanobot gateway` + `cd webui && bun run dev`
2. **创建两个 WebUI 会话** A 和 B，分别在聊天里让 agent 生成文件（例如 "写个 hello.py 保存到 outputs"）
3. **检查磁盘**：`ls ~/.nanobot/workspace/` 应看到 `outputs_websocket_<A>` 和 `outputs_websocket_<B>` 两个目录，各自含 `hello.py`；不应再有新文件落入旧的 `outputs/`
4. **检查 WebUI**：切换到会话 A 的 SessionDrawer 文件树，应只看到 `skills/` + `outputs_websocket_<A>/`（含 hello.py）；切换到会话 B 同理只看到自己的目录。两个会话都**不应**看到对方的 outputs 或旧 `outputs/`
5. **检查 subagent**：在会话 A 里触发一个会 spawn subagent 的任务（例如长任务），subagent 产出文件应落入 `outputs_websocket_<A>/`（父会话目录），不应单独建 subagent 目录
6. **检查其他渠道**（如可测）：Telegram 会话产出的目录名应是 `outputs_telegram_<chat_id>`
7. **单元测试**：给 `outputs_dir_for_session` 写测试覆盖 (a) 正常 session_key、(b) 含 `:` 的 key、(c) None 回退到 `outputs_default`；给 `list_workspace_files` 写测试验证只返回 `skills` + 当前 session 的 outputs 目录
8. **回归**：`ruff check nanobot/` + `cd webui && bun run test`
