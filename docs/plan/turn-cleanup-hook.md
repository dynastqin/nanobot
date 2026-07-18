# Turn 级资源自动清理 — Hook 方案实现计划 [done]

## Context

当 agent 用 `browser_navigate` 验证本地 HTML 时，会通过 `exec` 工具启动 `exec python3 -m http.server`，之后 agent 注意力丢失忘记调用 `write_stdin terminate`，留下孤儿进程。更一般地，tool 执行创建的副作用资源（shell session、临时文件、Java 进程等）都需要在 turn 结束时自动回收。

采用 hook 方案：在 `AgentHook` 中新增 `on_turn_end` 事件 + `TurnCleanupRegistry`（ContextVar 隔离）+ `CleanupHook` 内置 hook，tool 只需调用 `register_cleanup(fn)` 注册清理回调即可。

## 改动文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `nanobot/agent/hook.py` | 修改 | 新增 `TurnEndHookContext` + `on_turn_end` 方法 + `CompositeHook` 转发 |
| `nanobot/agent/cleanup.py` | 新建 | `TurnCleanupRegistry` + ContextVar + `register_cleanup` / `drain_cleanup` |
| `nanobot/agent/cleanup_hook.py` | 新建 | `CleanupHook(AgentHook)` 实现 |
| `nanobot/agent/loop.py` | 修改 | 绑定/重置 ContextVar，引入 `CleanupHook`，调用 `on_turn_end` |
| `nanobot/agent/tools/shell.py` | 修改 | `_execute_session()` 中注册清理回调 |

## 详细步骤

### Step 1: `hook.py` — 新增 `TurnEndHookContext` 和 `on_turn_end`

在 `AgentRunHookContext` 之后（第 44 行后）、`AgentHook` 类之前插入：

```python
@dataclass(slots=True)
class TurnEndHookContext:
    """Snapshot exposed to hooks at turn end (after SAVE, before RESPOND)."""
    session_key: str | None = None
    stop_reason: str | None = None
    error: str | None = None
    tools_used: list[str] = field(default_factory=list)
```

在 `AgentHook` 类的 `on_finally` 之后（第 66 行后）增加：

```python
async def on_turn_end(self, context: TurnEndHookContext) -> None:
    """Called after runner finishes, before context vars are reset.

    This is the correct place to drain cleanup registries — the
    runner's work is done but session context is still available.
    """
    pass
```

在 `CompositeHook.after_iteration` 之后（第 157 行后）增加转发：

```python
async def on_turn_end(self, context: TurnEndHookContext) -> None:
    await self._for_each_hook_safe("on_turn_end", context)
```

### Step 2: `cleanup.py` — 新建清理注册表

```python
"""Turn-scoped cleanup registry for side-effect resources."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token
from typing import Awaitable, Callable

from loguru import logger

CleanupFn = Callable[[], Awaitable[None]]


class TurnCleanupRegistry:
    __slots__ = ("_callbacks",)

    def __init__(self) -> None:
        self._callbacks: list[CleanupFn] = []

    def register(self, fn: CleanupFn) -> None:
        self._callbacks.append(fn)

    async def drain(self) -> None:
        for fn in reversed(self._callbacks):  # LIFO
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Turn cleanup callback failed, continuing")
        self._callbacks.clear()


_current_cleanup_registry: ContextVar[TurnCleanupRegistry | None] = ContextVar(
    "nanobot_turn_cleanup_registry", default=None
)


def bind_cleanup_registry() -> Token[TurnCleanupRegistry | None]:
    return _current_cleanup_registry.set(TurnCleanupRegistry())


def reset_cleanup_registry(token: Token[TurnCleanupRegistry | None]) -> None:
    _current_cleanup_registry.reset(token)


def register_cleanup(fn: CleanupFn) -> None:
    """Register an async cleanup callback for the current turn.

    Safe to call when no registry is bound (no-op).
    """
    registry = _current_cleanup_registry.get()
    if registry is not None:
        registry.register(fn)


async def drain_cleanup() -> None:
    """Drain the current turn's cleanup registry."""
    registry = _current_cleanup_registry.get()
    if registry is not None:
        await registry.drain()
```

### Step 3: `cleanup_hook.py` — 新建 CleanupHook

```python
"""Hook that drains the turn cleanup registry at turn end."""

from __future__ import annotations

from loguru import logger

from nanobot.agent.cleanup import drain_cleanup
from nanobot.agent.hook import AgentHook, TurnEndHookContext


class CleanupHook(AgentHook):
    """Drains the per-turn cleanup registry in on_turn_end."""

    def __init__(self) -> None:
        super().__init__(reraise=False)

    async def on_turn_end(self, context: TurnEndHookContext) -> None:
        logger.debug(
            "Draining turn cleanup registry for session {} (stop_reason={})",
            context.session_key,
            context.stop_reason,
        )
        await drain_cleanup()
```

### Step 4: `shell.py` — `_execute_session()` 注册自动清理

在 `_execute_session()` 方法中，`manager.start()` 返回后、`return` 前插入：

```python
from nanobot.agent.cleanup import register_cleanup

# 在 session_id 获取后立即注册
captured_session_id = session_id

async def _cleanup_session() -> None:
    try:
        await self._session_manager.write(
            session_id=captured_session_id,
            chars=None,
            close_stdin=False,
            terminate=True,
            yield_time_ms=0,
            max_output_chars=1000,
            owner_session_key=current_request_session_key(),
        )
    except KeyError:
        pass  # 已被显式终止或自然退出
    except Exception:
        logger.debug("Auto-cleanup of exec session failed", exc_info=True)

register_cleanup(_cleanup_session)
```

注意：需用闭包捕获 `session_id`（`captured_session_id`），避免晚绑定问题。

### Step 5: `loop.py` — 集成到 agent 生命周期

**5a. 引入 CleanupHook（第 757 行）**

```python
from nanobot.agent.cleanup_hook import CleanupHook

# 改这一行，把 CleanupHook 放在 extra_hooks 之后、外部 hooks 之前
run_hooks = [*self._extra_hooks, CleanupHook(), *(hooks or [])]
```

**5b. 绑定/重置 cleanup ContextVar（第 849-904 行）**

```python
from nanobot.agent.cleanup import bind_cleanup_registry, reset_cleanup_registry

# 第 851 行后新增
cleanup_token = bind_cleanup_registry()

# 第 864 行，把 result 初始化移到 try 之前
result = None

# finally 块改为（第 901-904 行）：
finally:
    # Fire on_turn_end before resetting context vars so cleanup
    # callbacks can access request context / workspace scope.
    turn_end_ctx = TurnEndHookContext(
        session_key=active_session_key,
        stop_reason=result.stop_reason if result is not None else "error",
        error=result.error if result is not None else None,
    )
    try:
        await hook.on_turn_end(turn_end_ctx)
    except Exception:
        logger.exception("AgentHook.on_turn_end error")

    reset_workspace_scope(workspace_token)
    reset_request_context(request_token)
    reset_file_states(file_state_token)
    reset_cleanup_registry(cleanup_token)
```

**5c. 处理 result 为 None 的情况（第 905 行后）**

原代码 `self._last_usage = result.usage`，当 runner 抛异常时 `result` 为 None。但由于 finally 中已处理上下文，这里需加保护：

```python
if result is None:
    raise RuntimeError("Agent runner returned None")
self._last_usage = result.usage
```

> 注意：原代码已有此问题（runner.run() 抛异常时 result 未绑定会导致 UnboundLocalError）。此处显式处理，不改变原有行为。

### Step 6: `progress_hook.py` — 无需改动

`AgentProgressHook` 继承 `AgentHook`，`on_turn_end` 使用基类默认 no-op，无需修改。

## 生命周期总览

```
_run_agent_loop()
  ├── bind_file_states() + bind_request_context() + bind_workspace_scope()
  ├── bind_cleanup_registry()                          ← NEW
  ├── runner.run(spec)
  │     ├── hook.before_run()
  │     ├── _run_core() [多次迭代]
  │     │     ├── before_iteration / after_iteration
  │     │     └── tools 执行 → register_cleanup(fn)    ← NEW
  │     ├── hook.after_run()
  │     └── hook.on_finally()
  ├── finally:
  │     ├── hook.on_turn_end(turn_ctx)                 ← NEW
  │     │     └── CleanupHook → drain_cleanup()
  │     │           └── 每个 register_cleanup 的回调执行
  │     ├── reset_workspace_scope()
  │     ├── reset_request_context()
  │     ├── reset_file_states()
  │     └── reset_cleanup_registry()                   ← NEW
```

## 边界情况

| 场景 | 处理方式 |
|---|---|
| Agent 已显式 terminate session | `write(terminate=True)` → KeyError → 捕获忽略 |
| Session 自然退出 | 同上 |
| Turn 被取消 (CancelledError) | finally 中 on_turn_end 仍执行；CancelledError 在 drain 中 re-raise |
| 清理回调自身抛异常 | drain() 捕获 Exception，记录日志，继续执行后续回调 |
| runner.run() 抛异常 | finally 中 on_turn_end 仍执行，stop_reason="error" |
| 无 registry 绑定（测试/子代理） | register_cleanup() 静默 no-op |
| 多个 tool 创建资源 | 所有回调按 LIFO 顺序执行 |

## 验证计划

1. **单元测试** (`tests/agent/test_cleanup.py`):
   - `TurnCleanupRegistry.register()` / `drain()` 顺序（LIFO）
   - drain 中单个回调异常不影响其他回调
   - 空 registry drain 不报错
   - ContextVar bind/reset 隔离

2. **集成测试** (`tests/agent/tools/test_shell.py`):
   - `exec` + `yield_time_ms` 创建 session 后，验证 `register_cleanup` 被调用

3. **手动验证**:
   ```bash
   # 启动 gateway
   nanobot gateway
   # 发送一个需要启动 http.server 的任务
   # 任务完成后检查进程：lsof -ti :<port>
   # 确认 http.server 已被清理
   ```

4. **现有测试回归**:
   ```bash
   uv run pytest tests/agent/ -v -k "not slow"
   cd webui && bun run test
   ```
