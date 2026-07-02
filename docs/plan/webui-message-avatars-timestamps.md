# WebUI 对话头像与时间戳设计

- 日期：2026-07-02
- 范围：`webui/` 消息列表（ThreadMessages）渲染
- 目标：在对话中为每条消息展示 user/assistant 头像图标与消息时间戳，提升可读性与时序感知

## 背景

当前 WebUI 的消息列表：

- **User 消息**：右对齐的圆角气泡（`bg-secondary/70`），无头像、无时间
- **Assistant 消息**：左对齐的 markdown 文本，无头像、无时间

用户在阅读长对话时难以快速分辨角色与把握消息时序。需要在每条消息上同时展示角色头像与发送时间。

## 决策记录

| 决策点 | 选择 |
|---|---|
| 头像形式 | 首字母圆形（U / A） |
| 时间戳位置 | 消息内容下方 |
| 时间戳格式 | `YYYY/MM/DD HH:MM:SS` |
| 时间戳频率 | 每条消息都显示 |

## 设计

### 头像（Avatar）

- 32×32 圆形，白色字母居中
- User：灰色渐变背景 `linear-gradient(135deg, #64748b, #475569)`，字母 `U`
- Assistant：紫色渐变背景 `linear-gradient(135deg, #6366f1, #8b5cf6)`，字母 `A`
- 字母字重 600、字号 13px

### 时间戳

- 位置：消息内容下方（与内容左/右对齐）
- 字号 11px，颜色 `text-muted-foreground`，`font-variant-numeric: tabular-nums`
- 时间来源：`UIMessage.createdAt`（epoch ms）
- 格式函数 `formatMessageTime(ms)`: 返回 `YYYY/MM/DD HH:MM:SS`（使用本地时区）

### 布局

每条消息的展示单元结构：

```
[user 侧，右对齐]
  [U avatar]   [content column: bubble + time (right-aligned)]

[assistant 侧，左对齐]
  [A avatar]   [content column: markdown + time (left-aligned)]
```

实现为水平 flex 容器：

- User：`flex-direction: row-reverse`，内容列 `align-items: flex-end`
- Assistant：`flex-direction: row`，内容列 `align-items: flex-start`
- Activity cluster（工具调用提示）也显示在 assistant 头像右侧内容区（保持原有渲染）
- TraceGroup（工具详情折叠组）保持不变（它是 subordinate 信息，不需要头像）

### 组件职责划分

- **新建 `Avatar` 组件**（`webui/src/components/Avatar.tsx`）：
  - Props: `role: "user" | "assistant"`，可选 `size`
  - 只负责渲染圆形字母头像
- **新建 `formatMessageTime` 工具函数**（`webui/src/lib/format.ts`）：
  - 接收 `createdAt: number`，返回格式化字符串
  - 处理无效输入返回空字符串
- **修改 `ThreadMessages.tsx`**：
  - 在每个 `MessageBubble` / `AgentActivityCluster` 外层包裹「头像 + 内容 + 时间」行布局
  - 根据 `unit.message.role`（对 message 类型）或固定 assistant（对 activity 类型）决定头像
  - `TraceGroup` 由 `MessageBubble` 内部仍按原样返回，但外层依然带 assistant 头像
- **`MessageBubble` 内部保持不变**：
  - 继续只负责消息内容渲染（bubble、markdown、媒体、footer 动作）
  - 时间戳由外层 `ThreadMessages` 统一渲染，避免每个 role 分支重复

### 数据依赖

- `UIMessage.createdAt` 已存在（epoch ms），由 gateway 在消息推送时填充
- 无需后端变更

### 可访问性

- 头像添加 `aria-hidden="true"`（纯装饰，角色已通过位置和内容暗示）
- 时间戳使用 `title` 属性展示完整时间（与显示内容一致，便于屏幕阅读器）
- 颜色对比度满足 WCAG AA（11px muted-foreground 在默认背景上已符合现有设计）

### 不变项

- `MessageBubble` 内部逻辑不变（复制按钮、fork 按钮、latency footer 等保留）
- 消息动画（`animate-in fade-in-0 slide-in-from-bottom-1`）保留
- 流式输入态（`TypingDots`）保留
- Reasoning bubble、TraceGroup 渲染逻辑保留
- 现有测试用例不应因本变更而失败（新布局包裹在外层）

## 非目标

- 不做用户自定义头像上传（保持首字母样式）
- 不做时间分组/分隔符（每条消息都显示）
- 不做 hover 显隐逻辑
- 不修改 agent-chat-ui 以外的渲染路径（如 CLI、API）

## 测试策略

- `Avatar` 组件：渲染 user / assistant 两种角色，验证字母和背景
- `formatMessageTime`：边界用例（0、无效值、跨时区）
- `ThreadMessages`：快照/挂载测试，验证 user 消息外层包含 U 头像 + 时间，assistant 消息包含 A 头像 + 时间
- 现有 `thread-messages.test.tsx`、`message-bubble.test.tsx` 应继续通过
