# Agent Activity Cluster

Agent Activity Cluster（活动追踪）是聊天界面中展示 agent 每一步操作的可视化组件。它将 agent 的思考、工具调用、文件编辑等活动按时间线分组渲染。

## v2 功能特性

> 基于 `docs/plan/2026-07-09-inline-tool-activity-plan.md` 的需求实现。

### 核心重构：Activity 展示架构

**消息分组（groupActivityMessages）**
- 将扁平的 activity messages 按时间顺序组织为交替的 `ReasoningGroup` / `TraceGroup`
- 连续多条 reasoning-only assistant 消息合并为一个 `ReasoningGroup`
- 每条 trace 消息独立为一个 `TraceGroup`
- 非 activity 消息自动过滤

**轮次分组（groupActivityRounds）**
- 在 `groupActivityMessages` 基础上进一步组织为 `ActivityRound`（思考 + 工具调用的配对）
- 每个 ReasoningGroup 开启新一轮，后续 TraceGroup 归入该轮
- 支持仅思考、仅工具调用、以及两者混合的消息序列

**渲染结构变更**
- **移除**旧的外层折叠面板（"Thought for Xs"）+ 内部滚动视口（scrollport）
- **新增** `ReasoningBlock`：每个思考组独立可折叠卡片
- **新增** `TraceActivityCard`：每条 trace 消息始终可见的工具卡片
- **新增** `ActivityRoundContainer`：将一轮思考+工具调用包裹在带边框的圆角卡片中
- 保留 `FileEditFlatActivity`（纯文件编辑轮次）和尾部 `FileEditGroup`（混合轮次中的文件编辑汇总）

### ReasoningBlock（思考块）
˜
- 每个 ReasoningBlock 拥有独立的展开/折叠状态，互不影响
- 折叠时显示标题（Brain 图标 + ChevronRight 箭头），展开时箭头旋转 90°，内容区带左侧竖线缩进
- **流式中自动展开**：当该块是最后一个块且处于流式状态时，自动展开显示推理内容
- **900ms 停留**：流式结束后最后一块保持展开 900ms 后自动折叠
- 用户手动点击后覆盖自动行为
- 从消息 `createdAt` 时间戳计算时长，流式显示 "Thinking for Xs"，完成显示 "Thought for Xs"
- 使用 `MarkdownText` 渲染推理内容，预加载优化性能

### TraceActivityCard（工具调用卡片）

- 每条 trace 消息渲染为一张卡片，始终可见无需点击展开
- 工具行由 `describeTraceLine()` 自动分类：

| 类型 | 图标/标记 | 标签文字 | 说明 |
|------|----------|---------|------|
| 搜索 | Search 图标 | Searching | 函数名含 "search" |
| 网页读取 | 网站 favicon | Reading | fetch/read/open + 公开 URL |
| Shell 命令 | Wrench 图标 | Command | exec/shell/bash 等 |
| 通用工具 | Wrench 图标 | Using + 函数名 | 其他工具调用 |
| 完成标记 | CheckCircle2 图标 | Done | 完成/成功类消息 |
| 默认 | Layers 图标 | Working | 无法归类的 trace |

- 有 `toolEvent` 数据的行支持行内展开 `ToolCallDetail`（Arguments / Result / Error JSON 块，带复制按钮）
- CLI App 运行显示品牌 Logo + 状态（Running/Used/Failed），参数中密钥自动脱敏
- MCP 运行显示 Preset 品牌 Logo + 工具名 + 参数预览，支持展开详情
- 支持媒体证据展示（图片/视频/文件）

### 纯文件编辑轮次（FileEditFlatActivity）

- 保留原有逻辑：仅文件编辑时显示紧凑单行摘要
- "Editing / Edited / Failed / Deleting / Deleted + 文件名 + diff 统计（+N -M）"
- 多文件或含错误/待处理时展开为文件列表

### 辅助功能

- 总时长标签：轮次卡片下方显示 "Working for Xs" / "Worked for Xs"
- Shell 命令安全处理：脱敏 API Key/Token/Secret，路径压缩，脚本行数统计
- URL 仅展示公开地址，过滤私有 IP/内网

### 品牌系统优化（provider-brand）

- `logoFallbackUrls` 简化：移除 `domainFromLogoUrl` 函数，Google/DuckDuckGo favicon 代理 URL 直接返回空数组，回退到本地图标

### 后端变更（Python）

- MCP `enabled` 字段支持：连接和重载时跳过 `enabled=False` 的配置
- Agent Loop 健壮性：`CancelledError` 处理优化，Python 3.12+ `uncancel()` 兼容
- Transcript JSON 紧凑格式：`separators=(',', ':')`

### CSS 新增

- `activity-detail-shimmer`：工具行 hover 文字渐变闪烁动画
- `.scrollbar-thin` / `.scrollbar-track-transparent`：细滚动条样式工具类

### 测试覆盖

- 新增：`groupActivityMessages`（5 用例）、`groupActivityRounds`（7 用例）、`ReasoningBlock`（6 用例）、`TraceActivityCard`（4 用例）、集成测试（6 用例）
- 移除：滚动视口相关测试、旧聚合标签测试
- 更新：`thread-messages` 断言适配新 UI、`provider-brand` favicon 代理测试

---

## 整体结构

```
AgentActivityCluster
├── ReasoningBlock          # 思考块（可展开/折叠）
└── TraceActivityCard       # 工具活动卡片
    ├── ActivityTraceRow    # 通用 trace 行
    ├── CliRunRow           # CLI 应用执行行
    ├── McpRunRow           # MCP 工具调用行
    ├── ActivityEvidenceList # 附件证据（图片/视频）
    └── FileEditGroup       # 文件编辑行列表
        └── FileEditRow
```

## 活动行分类

### 1. 通用 Trace 行（ActivityTraceRow）

由 `describeTraceLine()` 解析 trace 消息的每一行，自动归类：

| kind | label | 匹配规则 | 示例 |
|---|---|---|---|
| `search` | Searching | 函数名含 `search` | `search("query")` |
| `tool` | Reading | 函数名含 `fetch`/`read`/`open` 或 URL | `read("https://...")` |
| `tool` | Command | shell 命令 trace | `bash("ls -la")` |
| `tool` | Using | 其他带函数名的 trace | `tool_name("args")` |
| `done` | Done | 文本含 `done`/`complete`/`success` | `done` |
| `trace` | Working | 无法归类的内容 | 自由文本 |

所有这类行都有 `detail` 文本，鼠标 hover 时会触发 shimmer 流动动画效果。

### 2. CLI 应用执行行（CliRunRow）

渲染 CLI 应用的执行记录（如 `@gh --version`、`@npm install`）。数据来源于 trace 消息中特定格式的行，由 `parseCliRunTrace()` 解析。

- **label**: 状态动词（Using / Used / Failed）
- **detail**: 应用名 + 参数（如 `@gh --version`）
- **marker**: 应用品牌 logo（带 `animate-pulse` 活动指示）
- **tone**: active → active / done → success / error → error

### 3. MCP 工具调用行（McpRunRow）

渲染 MCP 预设的工具调用记录（如 `github · search_repositories`）。由 `parseMcpRunTrace()` 解析。

- **label**: 状态动词（Using / Used / Failed）
- **detail**: 预设名 + 工具名 + 参数预览（如 `github · search_repositories · query=...`）
- **marker**: MCP 预设 logo（带 `animate-pulse` 活动指示）
- **tone**: active → active / done → success / error → error
- **children**: 可展开的 `ToolCallDetailContent`（工具调用详情）

### 4. 文件编辑行（FileEditRow）

渲染文件编辑操作记录（写入/删除）。由 `collectFileEdits()` 收集。

- **label**: `FileReferenceChip`（文件路径芯片）
- **marker**: 状态图标
  - 编辑中: `CircleDashed`（旋转动画）
  - 完成: `CheckCircle2`（绿色）
  - 失败: `AlertCircle`（红色）
- **aside**: `DiffPair`（新增/删除行数统计）
- **children**: 错误详情（失败时显示）

### 5. 附件证据行（ActivityEvidenceList）

展示 agent 找到的图片/视频等附件。

- **label**: "Found image(s)" / "Found video(s)"
- **children**: `ActivityEvidencePreview`（缩略图预览）

## 核心组件

### ActivityStep

所有活动行的基础组件（`webui/src/components/thread/activity/ActivityStep.tsx`）。

```ts
interface ActivityStepProps {
  label: ReactNode;        // 左侧状态标签
  detail?: ReactNode;      // 右侧描述文本（有则支持 shimmer）
  marker?: ReactNode;      // 左侧图标/标记
  tone?: "neutral" | "active" | "success" | "error";
  active?: boolean;        // 是否处于进行中状态
  children?: ReactNode;    // 展开内容
  aside?: ReactNode;       // 右侧附加内容
  onClick?: () => void;    // 点击回调
}
```

**Shimmer 规则**: 只要传了 `detail` prop 且不为 null，`.activity-detail-text` 元素就会渲染，hover 时 CSS 规则 `.activity-detail-row:hover .activity-detail-text` 自动触发 `activity-detail-shimmer` 流动动画（定义在 `globals.css`）。

### 核心源文件

| 文件 | 说明 |
|---|---|
| `webui/src/components/thread/AgentActivityCluster.tsx` | 主组件：聚类、分析、卡片渲染、trace 行 |
| `webui/src/components/thread/activity/ActivityStep.tsx` | 基础行组件 |
| `webui/src/components/thread/activity/FileEditRow.tsx` | 文件编辑行 |
| `webui/src/components/thread/activity/ReasoningRow.tsx` | 思考行 |
| `webui/src/components/thread/activity/ToolCallDetail.tsx` | 工具调用详情展开 |
| `webui/src/globals.css` | shimmer 动画定义 |
