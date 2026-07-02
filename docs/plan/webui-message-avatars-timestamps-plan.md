# WebUI 对话头像与时间戳 实现计划

**Goal:** 在 WebUI 对话中为每条消息展示 user/assistant 头像图标与消息时间戳。

**Architecture:** 新增 `Avatar` 组件和 `formatMessageTime` 工具函数。在 `ThreadMessages` 的每条消息/activity 外层包裹「头像 + 内容列 + 时间」行布局，`MessageBubble` 内部保持不变。

**Tech Stack:** React + TypeScript + Tailwind CSS

**约束:** 不写单测，不提交 git。

---

## 文件结构

- 新建: `webui/src/components/Avatar.tsx` — 首字母圆形头像组件
- 修改: `webui/src/lib/format.ts` — 新增 `formatMessageTime` 函数
- 修改: `webui/src/components/thread/ThreadMessages.tsx` — 在消息外层包裹头像+时间行布局

---

### Task 1: 新增 `formatMessageTime` 工具函数

**Files:**
- Modify: `webui/src/lib/format.ts`

- [x] **Step 1: 在 `format.ts` 末尾新增 `formatMessageTime` 函数**

```ts
/** Format epoch-ms timestamp as ``YYYY/MM/DD HH:MM:SS`` (local timezone).
 *  Returns empty string for invalid/missing input. */
export function formatMessageTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}
```

- [x] **Step 2: 验证 dev 构建不报错**

Run: `cd webui && bun run build`
Expected: build 成功

---

### Task 2: 新增 `Avatar` 组件

**Files:**
- Create: `webui/src/components/Avatar.tsx`

- [x] **Step 1: 创建 `Avatar.tsx`**

```tsx
import { cn } from "@/lib/utils";

export type AvatarRole = "user" | "assistant";

interface AvatarProps {
  role: AvatarRole;
  size?: number;
  className?: string;
}

const ROLE_STYLES: Record<AvatarRole, { bg: string; letter: string }> = {
  user: {
    bg: "linear-gradient(135deg, #64748b, #475569)",
    letter: "U",
  },
  assistant: {
    bg: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    letter: "A",
  },
};

/**
 * 32x32 circular initial-letter avatar.
 *
 * User  = grey gradient + "U"
 * Assistant = purple gradient + "A"
 *
 * Purely decorative — role is already implied by message position.
 */
export function Avatar({ role, size = 32, className }: AvatarProps) {
  const style = ROLE_STYLES[role];
  const fontSize = Math.round(size * 0.4);
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: style.bg,
        fontSize,
      }}
    >
      {style.letter}
    </div>
  );
}
```

- [x] **Step 2: 验证 dev 构建不报错**

Run: `cd webui && bun run build`
Expected: build 成功

---

### Task 3: 在 `ThreadMessages` 中包裹头像+时间行布局

**Files:**
- Modify: `webui/src/components/thread/ThreadMessages.tsx`

- [x] **Step 1: 在文件顶部新增导入**

在现有 import 区域添加：

```ts
import { Avatar } from "@/components/Avatar";
import { formatMessageTime } from "@/lib/format";
```

- [x] **Step 2: 新增 `MessageRow` 辅助组件**

在 `ThreadMessages` 组件之前（`export function ThreadMessages` 上方）添加：

```tsx
interface MessageRowProps {
  role: "user" | "assistant";
  /** First message timestamp (epoch ms) for the unit. */
  timestamp: number | undefined;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps a message's content with the avatar on the correct side and
 * the formatted timestamp below the content.
 *
 * User  side: row-reverse, content column right-aligned
 * Assistant side: row, content column left-aligned
 */
function MessageRow({ role, timestamp, className, children }: MessageRowProps) {
  const isUser = role === "user";
  const timeLabel = formatMessageTime(timestamp);
  return (
    <div
      className={cn(
        "flex w-full gap-2.5",
        isUser ? "flex-row-reverse" : "flex-row",
        className,
      )}
    >
      <Avatar role={role} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          isUser ? "items-end" : "items-start",
        )}
      >
        {children}
        {timeLabel ? (
          <span
            className="mt-1 text-[11px] leading-none text-muted-foreground tabular-nums"
            title={timeLabel}
          >
            {timeLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
```

- [x] **Step 3: 在 units.map 的渲染处使用 `MessageRow` 包裹**

替换当前的渲染块（保留 forkBoundary 逻辑和 Fragment key 结构）：

将原本的：
```tsx
<div className={marginTop} data-user-prompt-id={userPromptId}>
  {unit.type === "activity" ? (
    <AgentActivityCluster ... />
  ) : (
    <MessageBubble ... />
  )}
</div>
```

改为：
```tsx
<div className={marginTop} data-user-prompt-id={userPromptId}>
  {unit.type === "activity" ? (
    <MessageRow role="assistant" timestamp={unit.messages[0]?.createdAt}>
      <AgentActivityCluster
        messages={unit.messages}
        isTurnStreaming={liveActivityClusterIndices.has(index)}
        hasBodyBelow={hasBodyBelow}
        turnLatencyMs={unit.turnLatencyMs}
        cliApps={cliApps}
        mcpPresets={mcpPresets}
        onOpenFilePreview={onOpenFilePreview}
        onOpenLink={onOpenLink}
      />
    </MessageRow>
  ) : (
    <MessageRow role={unit.message.role} timestamp={unit.message.createdAt}>
      <MessageBubble
        message={unit.message}
        showAssistantCopyAction={
          unit.message.role === "assistant"
            ? copyFlags[index]
            : true
        }
        cliApps={cliApps}
        mcpPresets={mcpPresets}
        onOpenFilePreview={onOpenFilePreview}
        onOpenLink={onOpenLink}
        onForkFromHere={
          onForkFromMessage && forkIndex !== undefined
            ? () => onForkFromMessage(forkIndex)
            : undefined
        }
      />
    </MessageRow>
  )}
</div>
```

- [x] **Step 4: 验证 user 消息宽度约束仍正确**

`MessageBubble` 内部 user 消息有 `ml-auto max-w-[min(85%,36rem)]`。在 `MessageRow` 的内容列（`flex-1 min-w-0 items-end`）包裹下：

- 内容列占满行宽（减去 avatar 32px + gap）
- 气泡的 `ml-auto` 推至列右侧
- 气泡的 `max-w` 以内容列为参考，≈ 85% 行宽，符合预期
- 时间戳由列的 `items-end` 右对齐，与气泡右边缘对齐

无需修改 `MessageBubble` 内部样式。

- [x] **Step 5: 在浏览器中验证效果**

Run: `cd webui && bun run dev`
Open: http://localhost:5173
Expected:
- 每条 user 消息右侧有 U 头像（灰色渐变），下方显示 `YYYY/MM/DD HH:MM:SS`
- 每条 assistant 消息左侧有 A 头像（紫色渐变），下方显示时间
- Activity cluster 也有 A 头像
- TraceGroup 也有 A 头像（因为 MessageBubble 内部渲染 trace 时外层仍是 MessageRow）
- CompactionBanner 和 ForkBoundaryDivider 不变（没有头像）

- [x] **Step 6: 构建验证**

Run: `cd webui && bun run build`
Expected: build 成功，无类型错误
