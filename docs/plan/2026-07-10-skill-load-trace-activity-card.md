# 为 Skill 加载增加 TraceActivityCard

## 问题

当前模型匹配到 skill 后，通过 `read_file` 工具读取 `SKILL.md`，前端将其渲染为通用的 "Reading" 活动卡片（`ActivityTraceRow`），没有专门的 skill 加载卡片。用户希望增加一个专门的 **Skill Load TraceActivityCard**，让用户可以清晰看到 agent 加载了哪个 skill。

## 现状分析

### Skill 加载流程
1. 模型决定使用某 skill → 调用 `read_file` 工具读取 `{workspace}/skills/{name}/SKILL.md`
2. 后端 `AgentProgressHook.on_tool_call()` 发出通用的 `tool_hint` 事件（`name: "read_file"`, `arguments: {path: "..."}`)
3. 前端 `describeTraceLine()` 匹配到 `/read/i` → 分类为 "阅读"，渲染为通用 `ActivityTraceRow`（Wrench 图标 + "Reading" 标签）

### 无法仅靠工具名区分
CLI (`run_cli_app`)、MCP (`mcp_*`)、文件编辑 (`write_file/edit_file`) 都可以通过工具名模式区分，但 skill 加载使用的是通用 `read_file` 工具，必须结合文件路径（是否匹配 `**/skills/*/SKILL.md`）才能识别。

## 方案：后端标注

在 `progress_hook.py` 中检测 `read_file` 目标是 SKILL.md，给事件附加 `skill_load` 元数据。前端据此渲染专用 Skill Load 卡片。

## 需要改动的文件

### 后端（1 个文件）

#### `nanobot/agent/progress_hook.py`
- 在 `on_tool_call()` 中检测工具调用目标是否为 SKILL.md
- 判断逻辑：`name in ("read_file", "read")` 且 `arguments.path` 匹配 `**/skills/*/SKILL.md`
- 提取 skill 名称（从路径中解析 `skills/{name}/SKILL.md`）
- 在 tool event 中附加 `skill_load: {name: "skill-name"}` 元数据

### 前端（5 个文件）

#### `webui/src/lib/types.ts`
- 在 `ToolProgressEvent` 中增加可选字段：
  ```typescript
  skill_load?: { name: string }
  ```

#### `webui/src/lib/tool-traces.ts`
- 增加 `isSkillLoadEvent(event: ToolProgressEvent): boolean` 工具函数
- 增加 `extractSkillName(event: ToolProgressEvent): string | null` 工具函数

#### `webui/src/lib/activity-timeline.ts`
- `ActivityItemType` 增加 `"skill_load"` 类型
- `activityItemsForMessage()` 中识别 skill_load 事件
- `activitySourceFromToolName()` 增加 skill 映射

#### `webui/src/components/thread/AgentActivityCluster.tsx`
- `describeTraceLine()`：增加 skill_load 识别
- `TraceActivityCard`：识别 skill_load 行，渲染专用卡片
- 新增 `SkillLoadRow` 组件（或内联）
- `countActivity()`：增加 `skillCount` 统计

#### `webui/src/components/thread/activity/SkillLoadRow.tsx`（新文件）
- 专用组件，使用 `ActivityStep` 基元
- 图标：`<Zap />` 或 `<Puzzle />`，色调 indigo
- 标签：`"Loading skill {name}"` / `"Loaded skill {name}"`
- 状态：running（脉冲动画）→ done（绿色勾）

## 数据流

```
模型调用 read_file(path="skills/weather/SKILL.md")
  → AgentProgressHook.on_tool_call()
    → 检测 path 匹配 **/skills/*/SKILL.md
    → 提取 skill_name = "weather"
    → 发出 tool_hint 事件，附带 skill_load: {name: "weather"}
  → WebSocket → 前端 useNanobotStream
    → toolEvents 中包含 skill_load 元数据
  → AgentActivityCluster.TraceActivityCard
    → 检测到 skill_load → 渲染 SkillLoadRow 而非通用 ActivityTraceRow
```

## 关键设计决策

1. **skill_load 放在 tool event 内部**而非新事件类型，因为 skill 加载本质上是 `read_file` 工具调用的特化
2. **SkillLoadRow 复用 ActivityStep** 基元组件，保持视觉一致性
3. **不影响现有逻辑**：非 skill 的 `read_file` 调用仍然渲染为通用 "Reading" 卡片

## 验证方式

1. 启动 gateway + webui dev server
2. 发送一条会触发 skill 使用的消息（如 "查一下今天天气"）
3. 观察活动追踪面板中是否出现专门的 skill 加载卡片（带 skill 名称）
4. 确认普通的 `read_file`（非 SKILL.md）仍然显示为通用 "Reading" 卡片
5. 运行 `cd webui && bun run test` 确认无回归
