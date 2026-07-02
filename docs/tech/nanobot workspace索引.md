# nanobot Workspace 目录结构

`~/.nanobot/workspace` 是 nanobot agent 的运行时持久化数据目录，存放会话历史、长期记忆、技能扩展、定时任务、输出产物等所有工作数据。

## 目录总览

```
~/.nanobot/workspace/
├── SOUL.md                  # Agent 灵魂设定
├── USER.md                  # 用户档案
├── AGENTS.md                # Agent 行为指引
├── HEARTBEAT.md             # 心跳任务清单
├── .gitignore               # Git 忽略规则
├── sessions/                # 会话历史
├── memory/                  # 长期记忆
├── skills/                  # Agent 技能包
├── cron/                    # 定时任务
├── outputs_websocket_<uuid>/ # 会话独立输出目录
├── .nanobot/                 # 运行时数据
```

## 核心配置文件

### SOUL.md

定义 nanobot agent 的"灵魂"——核心行为准则：

- **务实执行**：能直接做的不要只描述计划
- **简洁回复**：除非被要求深入，回复尽量简短
- **诚实沟通**：知道就说，不确定就说，不假装确定
- **尊重用户时间**：把用户时间视为最稀缺资源

具体规则包括：单步任务立即执行、多步任务先列计划确认、读写文件前先检查、工具调用失败自动诊断重试、多步修改后验证结果。

### USER.md

用户档案，供 agent 了解使用者：

- 名称：歌秦 (Geqin)
- 公司：遥望科技
- 兴趣：Agent 技术

### AGENTS.md

工作区级别的 agent 行为规范：

- 定时提醒应使用内置 `cron` 工具，不要只写进 MEMORY.md
- 心跳任务通过编辑 `HEARTBEAT.md` 管理，使用 `apply_patch` 进行常规更新
- 不要创建重复的心跳定时任务（gateway 已内置）

### HEARTBEAT.md

心跳任务清单。gateway 启动时（`gateway.heartbeat.enabled=true`）自动注册一个保护性 cron job 定期读取此文件。无任务时 agent 直接跳过，完成任务后应删除而非保留。

### .gitignore

保护敏感和持久文件不被 git 跟踪：

```
!memory/
!SOUL.md
!USER.md
!memory/MEMORY.md
!.gitignore
```

`!` 前缀表示"否定忽略"——这些文件即使被父级规则忽略也会被跟踪。

## 子目录详解

### sessions/ — 会话历史

存放所有会话的 JSONL 消息记录，每条 JSON 对象为对话中的一次 turn。文件名编码了来源标识：

| 前缀 | 来源 |
|---|---|
| `websocket_<uuid>` | WebUI 会话 |
| `feishu_ou_<id>` | 飞书会话 |
| `cli_direct` | 命令行直接调用 |
| `dream_<timestamp>` | Dream 梦境记忆整合记录 |

还有一个 `.webui_session_index.json` 索引文件供 WebUI 快速查询会话列表。

### memory/ — 长期记忆

| 文件 | 用途 |
|---|---|
| `MEMORY.md` | 长期记忆内容（项目上下文、关键知识点、用户偏好等） |
| `history.jsonl` | 记忆变更历史 |
| `.cursor` | memory 读取进度位点 |
| `.dream_cursor` | dream 梦境整合进度位点 |

MEMORY.md 记录的内容示例：nanobot 的 AgentLoop 状态机流程、配置系统特点、MyTool 功能等。

### skills/ — Agent 技能包

每个子目录一个技能，技能通过目录下的 `SKILL.md` 或 `AGENTS.md` 定义，举例：

| 技能 | 类型 | 用途 |
|---|---|---|
| `fileupload-oss` | 本地目录 | OSS 文件上传 |
| `html-it` | 符号链接 | HTML 转图片/PDF |
| `work-report` | 本地目录 | 工作日报/周报生成 |

### cron/ — 定时任务

`jobs.json` 定义定时任务，`runs/` 存储执行历史。当前配置了两个任务：

| 任务 | 间隔 | 用途 |
|---|---|---|
| `dream` | 每 2 小时 | 触发记忆梦境整合，将短期对话沉淀为长期记忆 |
| `heartbeat` | 每 30 分钟 | 检查 HEARTBEAT.md 并执行其中的活跃任务 |


### outputs_websocket_<uuid>/ — 会话独立输出目录

每个 WebUI 会话有独立的输出目录，WebUI 的"交付物面板"按此展示。存放该会话中 agent 生成的文件，如 Python 脚本、审核报告、HTML 页面、Word 文档等。

### .nanobot/ — 运行时数据

nanobot 自身工具产生的运行时数据（如 `tool-results`、元数据等）。