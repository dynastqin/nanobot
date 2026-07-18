# Spawn 子代理重复触发 — 深入分析与修复计划 [done]

## 上下文

当 Agent 并行 spawn 多个子代理（如查询 3 个区域的天气）时，较慢的子代理结果未及时到达，Agent 在中间决策轮次中误判该子代理"失败/无响应"，重复 spawn 造成 token 浪费和 UI 混乱。

### 案例时间线

| 行号 | 事件 | 说明 |
|------|------|------|
| L260 | spawn x3 | Agent 同时 spawn 余杭区、西湖区、滨江区 |
| L259 | 西湖区完成 (13.7s) | 第一个完成，结果注入 Agent |
| L405 | spawn 余杭区 #2 | Agent 看到西湖区结果但没看到余杭区 → 重试 |
| L404 | 滨江区完成 (39.7s) | 滨江区结果到达 |
| L441 | 余杭区 #1 完成 (47.7s) | 首次 spawn 的余杭区终于完成 |
| L442 | spawn 余杭区 #3 | Agent 已在 L438 决定了工具调用，来不及看到 L441 |

### 根因链

1. **`_drain_pending` 在队列非空时不阻塞等待** (`loop.py:798-800`)：当有任何一个子代理结果已可用时，立即返回，不等待较慢的子代理。较慢的结果留到下一轮注入循环。
2. **`_MAX_INJECTION_CYCLES=5` 硬上限** (`runner.py:68`)：超过 5 轮注入后，剩余结果在 `finally` 块中作为独立新 turn 重新发布 (`loop.py:1137`)，触发全新的 agent 轮次。
3. **`get_running_count()` 膨胀** (`subagent.py:467-469`)：包括了已完成但 `_cleanup` 回调尚未运行的 task，计数不准确。
4. **无 spawn 级别去重** (`spawn.py:79-86`)：只检查并发数上限，不检查是否已有相同 label 的子代理在运行。
5. **LLM 上下文无子代理状态** (`context.py:31-41`)：`runtime_lines` 不包含子代理运行状态，LLM 完全不知道还有子代理在跑。

---

## 修复方案（按优先级排序）

### Fix 1: `_drain_pending` 批量等待窗口（关键 — 治本）

**文件**: `nanobot/agent/loop.py` `_drain_pending` (L767-816)

**问题**: 当非阻塞 drain 已拿到 1+ 条结果但仍有子代理在运行时，立即返回而不等待。

**修改**: 在非空 drain 后，如果仍有子代理在运行，增加一个短等待窗口（500ms~1s）来收集更多结果：

```python
# 在非阻塞 drain 后（L792 之后），如果 items 非空但还有子代理在运行
if items and len(items) < limit and session is not None \
        and self.subagents.get_running_count_by_session(session.key) > 0:
    try:
        msg = await asyncio.wait_for(pending_queue.get(), timeout=0.5)
        items.append(_to_user_message(msg))
        # 继续非阻塞 drain 剩余
        while len(items) < limit:
            try:
                items.append(_to_user_message(pending_queue.get_nowait()))
            except asyncio.QueueEmpty:
                break
    except asyncio.TimeoutError:
        pass  # 500ms 内没有新结果，直接返回已有结果
```

**效果**: 在子代理完成时间接近（<500ms 差距）时，一次注入就能收集全部结果，避免分多轮注入。

### Fix 2: Spawn label 去重保护（关键 — 安全网）

**文件**: `nanobot/agent/subagent.py` + `nanobot/agent/tools/spawn.py`

**问题**: `spawn()` 不检查是否已有相同 label 的子代理在运行。

**修改**:
1. 在 `SubagentManager` 新增 `find_running_by_label(session_key, label)` 方法，遍历 `_task_statuses` 查找相同 label（`subagent.py`）
2. 在 `SpawnTool.execute()` 中调用此方法，发现重复时返回提示信息而非重复 spawn（`spawn.py:79` 之后）

```python
# subagent.py 新增方法
def find_running_by_label(self, session_key: str, label: str) -> SubagentStatus | None:
    tids = self._session_tasks.get(session_key, set())
    for tid in tids:
        if tid in self._task_statuses:
            status = self._task_statuses[tid]
            if status.label == label:
                return status
    return None
```

### Fix 3: `get_running_count()` 准确性修复

**文件**: `nanobot/agent/subagent.py` (L467-469)

**问题**: `len(self._running_tasks)` 包含 completed 但 `_cleanup` 尚未运行的 task。

**修改**: 过滤掉 `done()` 的 task，与 `get_running_count_by_session` 保持一致：

```python
def get_running_count(self) -> int:
    return sum(1 for t in self._running_tasks.values() if not t.done())
```

### Fix 4: `runtime_lines` 增加子代理状态（辅助）

**文件**: `nanobot/agent/context.py` (L31-41)

**问题**: LLM 完全不知道还有子代理在运行。

**修改**: 在 `runtime_lines` 中增加子代理运行计数（需要传入 `subagent_manager` 参数或从 state 获取）：

```python
# 当有子代理运行时，添加类似：
# "You have 2 subagent(s) still running. Wait for their results 
#  before spawning duplicates. Use list_subagents to check status."
```

**注意**: 需要评估 context.py 是否有途径获取 subagent_manager。如果没有，可能需要通过 `state` 对象传递或在 `_run_agent_loop` 中附加。

### Fix 5: `list_subagents` 工具（辅助）

**文件**: 新建 `nanobot/agent/tools/list_subagents.py`（或追加到 `spawn.py`）

**问题**: Agent 无法查询正在运行的子代理状态，对比 `exec` 工具有 `list_exec_sessions`。

**修改**: 参照 `exec_session.py` 的 `ListExecSessionsTool` 模式，新建工具：
- `name`: `list_subagents`
- `read_only`: `True`
- `_scopes`: `{"core", "subagent"}`
- `execute()`: 调用 `SubagentManager.list_running(session_key)` 返回格式化表格
- 复用已有的 `SubagentStatus` dataclass（`subagent.py:33-46`）：task_id, label, phase, iteration, elapsed, error

```python
# SubagentManager 新增方法
def list_running(self, session_key: str | None = None) -> list[SubagentStatus]:
    """List running subagents, optionally filtered by session."""
    result = []
    for tid, status in self._task_statuses.items():
        if tid in self._running_tasks and not self._running_tasks[tid].done():
            if session_key is None or tid in self._session_tasks.get(session_key, set()):
                result.append(status)
    return result
```

---

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `nanobot/agent/subagent.py` | 新增 `find_running_by_label()`、`list_running()`；修复 `get_running_count()` |
| `nanobot/agent/tools/spawn.py` | `execute()` 中调用 label 去重检查 |
| `nanobot/agent/loop.py` | `_drain_pending` 增加批量等待窗口 |
| `nanobot/agent/context.py` | `runtime_lines` 增加子代理运行状态 |
| `nanobot/agent/tools/list_subagents.py` | **新建** — `list_subagents` 工具 |
| `tests/agent/test_subagent.py` | 新增去重、list、count 准确性的单元测试 |

---

## 实现顺序

1. **Fix 3** — `get_running_count()` 准确性（最简单，独立）
2. **Fix 1** — `_drain_pending` 批量等待（核心，有风险需仔细测试）
3. **Fix 2** — Spawn label 去重（安全网）
4. **Fix 5** — `list_subagents` 工具（需要新建文件和注册）
5. **Fix 4** — `runtime_lines` 子代理状态（依赖 context.py 接口设计）

---

## 验证方法

1. **单元测试**: 对 `get_running_count()`、`find_running_by_label()`、`list_running()` 写 pytest
2. **集成测试**: 模拟并行 spawn 3 个子代理，验证较慢的不被重复 spawn
3. **WebUI 测试**: 使用 `cd webui && bun run dev` 连接 gateway，发起并行 spawn 请求，观察：
   - 子代理结果是否在 1-2 轮注入内全部到达
   - 不再出现重复的天气查询结果
   - `list_subagents` 工具可正常返回运行中/已完成的子代理列表
4. **回归检查**: 运行 `uv run pytest tests/agent/ -v` 确保现有测试通过
