# AskUserQuestion Tool — Implementation Plan

## Decisions (from review)

- **批次级 ID**: 一次 `ask_user_question` 调用共享一个 question_id，前端一次提交所有答案
- **非 WebSocket 通道**: 返回错误让 LLM 自行用文本降级提问，不做文本回复解析
- **WebSocket 事件**: 复用现有 `agent_ui` 通道（`message` 事件的 `agent_ui` 字段），不新增独立事件类型
- **Bus 引用**: 工具通过 `ToolContext.bus` 获取 MessageBus

## Data Flow

```
LLM calls ask_user_question({questions: [...]})
  → Tool.execute() checks channel == "websocket", else returns error
  → Generates a batch question_id (UUID)
  → Publishes OutboundMessage with OUTBOUND_META_AGENT_UI (kind: "ask_user_question")
  → WebSocketChannel.send() includes agent_ui in message payload (existing behavior, line 1100)
  → Frontend receives message event, detects agent_ui.kind === "ask_user_question"
  → Frontend renders AskUserQuestionCard
  → Tool calls QuestionStateManager.await_answer() → blocks on asyncio.Event
  → User selects options + submits
  → Frontend sends {"type":"answer_question", question_id, answers}
  → WebSocketChannel._dispatch_envelope() routes to QuestionStateManager.resolve()
  → resolve() sets answer + event.set()
  → Tool unblocks, returns answers to LLM
```

## Files to Create

### 1. `nanobot/agent/tools/question_state.py` — QuestionStateManager

模块级单例，批次级 ID 管理：

```python
@dataclass
class QuestionBatch:
    question_id: str
    session_key: str
    questions: list[dict]  # [{id, question, header, options, multiSelect}]
    answer_event: asyncio.Event
    answers: dict[str, str] | None = None  # question.id → answer value
    created_at: float = field(default_factory=time.time)

class QuestionStateManager:
    def __init__(self, default_timeout_s: int = 300): ...
    async def add_batch(question_id, session_key, questions) -> QuestionBatch
    async def await_answer(question_id: str, timeout_s: int | None = None) -> dict
    async def resolve(question_id, answers: dict[str, str]) -> bool
    async def cleanup_session(session_key) -> None

def get_question_state_manager() -> QuestionStateManager: ...
```

### 2. `nanobot/agent/tools/ask_user_question.py` — AskUserQuestionTool

```python
@tool_parameters(...)
class AskUserQuestionTool(Tool):
    name = "ask_user_question"
    exclusive = True
    _scopes = {"core", "subagent"}

    @classmethod
    def create(cls, ctx) -> Tool:
        return cls(manager=get_question_state_manager(), bus=ctx.bus)

    async def execute(self, questions: list[dict]) -> str:
        # 1. 检查 channel（通过 current_request_context()）
        #    - 非 websocket → 返回错误文本，让 LLM 降级
        # 2. 为每个子问题生成独立 ID（前端用），批次共享一个 question_id
        # 3. 组装 agent_ui payload
        # 4. 发布 OutboundMessage（携带 OUTBOUND_META_AGENT_UI）
        # 5. 注册到 QuestionStateManager
        # 6. await manager.await_answer(question_id)  # 阻塞
        # 7. 格式化答案返回给 LLM
```

### 3. `webui/src/components/thread/activity/AskUserQuestionCard.tsx`

React 卡片组件：
- 渲染 1-4 个问题，每个问题显示 header 标签 + question 文本
- 选项以可点击卡片展示（label + description）
- 单选：radio 风格；多选：checkbox 风格
- 推荐选项（含 "(Recommended)"）高亮
- 每个问题有自由输入框
- Submit / Skip 按钮
- Props: `questions`, `onSubmit(answers)`, `onDismiss()`

## Files to Modify

### 4. `nanobot/channels/websocket.py` — 两处修改

**a) `_dispatch_envelope()` 中添加 `answer_question` 处理**:
```python
if t == "answer_question":
    question_id = envelope.get("question_id")
    answers = envelope.get("answers")
    manager = get_question_state_manager()
    resolved = await manager.resolve(question_id, answers)
    if not resolved:
        await self._send_event(connection, "error", detail="question not found")
        return
    await self._send_event(connection, "ack", type="answer_question", question_id=question_id)
    return
```

**b) `_cleanup_connection()` 中清理该连接对应 session 的待回答问题**:
需要能通过 connection 找到对应的 chat_ids，进而找到 session_key，清理该 session 的 pending questions。

### 5. `webui/src/lib/types.ts` — 添加类型定义

```typescript
export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionData {
  id: string;
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

// UIMessage 扩展 questionData 字段（或在 agent_ui 中检测）
```

### 6. `webui/src/lib/nanobot-client.ts` — 添加 sendAnswer 方法

```typescript
sendAnswer(chatId: string, questionId: string, answers: Record<string, string>): void {
    this.queueSend({
        type: "answer_question",
        chat_id: chatId,
        question_id: questionId,
        answers,
    });
}
```

### 7. `webui/src/hooks/useNanobotStream.ts` — 处理 ask_question

在消息处理中检测 `agent_ui.kind === "ask_question"`，创建携带 `questionData` 的 UIMessage。

### 8. `webui/src/components/thread/AgentActivityCluster.tsx` — 渲染问题卡片

检测 `UIMessage.questionData`，渲染 `AskUserQuestionCard`。

### 9. `webui/src/components/thread/activity/` — barrel export

## Verification

1. **单元测试**: `tests/agent/test_ask_user_question.py`
   - QuestionStateManager 的 add/await/resolve/cleanup 循环
   - 超时行为
   - 工具参数 schema 校验

2. **集成测试**: gateway + WebUI 端到端流程

3. **降级测试**: CLI 模式触发，验证返回错误文本

4. **边界情况**: 超时、WebSocket 断开、Skip 按钮、多问题并发
