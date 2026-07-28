
# 目标
当前nanobot在给出选项给用户选择时是纯文本的交互不太友好，我想增加一个工具AskUserQuestion（参考claude的方式），实现卡片给用户选择或其他（允许用户输入）的方式。简单做了一个demo你可以参考(/Users/geqin/data/askuserquestion/server.py)，请结合当前项目进行设计 

# 在Skill或用户输入中如何用AskUserQuestion


### 1. 指明触发时机

```markdown
## 交互规则

在开始实现之前，如果遇到以下情况，必须使用 AskUserQuestion 工具向用户确认：
- 需求中存在多种合理的实现方案时
- 技术选型不明确时
- 用户偏好可能影响架构决策时
```

### 2. 给出问题结构规范

`AskUserQuestion` 工具的接口要求是：1-4 个问题，每个问题有 `header`（≤12字符）、`question`（问题文本）、`options`（2-4个 `{label, description}` 对象）。所以 skill 里应该这样规范：

```markdown
## 提问格式要求

使用 AskUserQuestion 时遵循以下规则：
- header：不超过 12 个字符的简短标签
- 每个问题提供 2-4 个选项
- 每个选项必须是 {label, description} 结构
- 推荐选项放在第一位，label 后加 "(Recommended)"
- 不要在选项中添加"其他"选项（系统会自动提供自由输入）
- 如果需要多选，说明 multiSelect: true
```

### 3. 提供具体示例

这是最有效的部分——给我一个具体的示例，让我在执行时照着做：

```markdown
## 示例

当需要确认前端框架时，调用 AskUserQuestion：

问题: "使用哪个前端框架？"
header: "前端框架"
options:
  - label: "React (Recommended)"
    description: "生态丰富，社区庞大，适合复杂交互"
  - label: "Vue"
    description: "上手简单，模板语法直观"
  - label: "Svelte"
    description: "编译时优化，包体积小"
```

---

## 完整的 SKILL.md 示例

下面是一个实际可用的 skill 文件模板，你可以直接参考：

```markdown
# My Skill

## 概述
这个 skill 用于 [功能描述]。

## 执行流程
1. 分析用户需求
2. 如果存在歧义或多种方案 → 使用 AskUserQuestion 向用户确认
3. 根据用户选择执行对应方案
4. 输出结果

## 交互规则
在以下场景中，必须使用 AskUserQuestion 工具提问，不要自行假设：

### 场景 1：技术选型
当 [具体条件] 时，询问：
- header: "技术选型"
- options:
  - {label: "方案A (Recommended)", description: "..."}
  - {label: "方案B", description: "..."}

### 场景 2：功能范围确认
当 [具体条件] 时，询问（multiSelect: true）：
- header: "功能范围"
- options:
  - {label: "功能1", description: "..."}
  - {label: "功能2", description: "..."}
  - {label: "功能3", description: "..."}

## 提问格式要求
- header ≤ 12 字符
- 每个问题 2-4 个选项
- 选项为 {label, description} 结构
- 推荐项放第一位，label 加 "(Recommended)"
- 不要加"其他"选项
- 一批最多问 4 个问题
```

---

## 核心原则总结

| 原则 | 说明 |
|------|------|
| **Skill 是指令，不是代码** | 你在 SKILL.md 里用自然语言告诉我"何时问、问什么"，我会在运行时调用 `AskUserQuestion` 工具 |
| **结构对齐工具接口** | 描述中的 header/option/label/description 要和工具参数结构一致，这样我能准确映射 |
| **给具体示例最有效** | 比起抽象规则，一个完整的提问示例能让我更精准地执行 |
| **明确触发条件** | 不要只写"必要时提问"，要写清楚**什么具体情况**下提问 |
| **不要加"其他"选项** | 工具会自动提供自由输入兜底，skill 里不用要求 |