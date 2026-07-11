# 分支对比：geqin_v0.2.2 vs fork main

> 对比时间：2026-07-10
>
> 当前分支：`geqin_v0.2.2`
>
> fork main：`dynastqin/nanobot` (`geqin/main`)
>
> 共同祖先：`e2e75c91`

---

## 一、当前分支 `geqin_v0.2.2` 有、fork `main` 没有（24 个提交）

### 活动追踪（Agent Activity Timeline）

| 提交 | 说明 |
|------|------|
| `98f43f72` | 重构为内联交错展示，思考块与工具卡片交替渲染 |
| `e082974b` | 支持展开工具调用详情（参数/结果/错误 JSON） |
| `0c1a3281` | 新增技能加载行，识别 SKILL.md 读取事件 |

### Plan 工具与进度面板

| 提交 | 说明 |
|------|------|
| `eee723c4` | 从上游 PR #3791 迁移 plan 工具，支持 create/update/show/done（42 个测试） |
| `161e329f` | 计划进度通过 WebSocket 实时推送至 WebUI |
| `80185548` | 计划与 goal 深度融合，WebSocket 重连恢复进度，自动归档 |

### 交付物面板与文件系统

| 提交 | 说明 |
|------|------|
| `8091f3c5` | 交付物面板、会话文件树、文件预览、链接预览统一面板系统 |
| `c053d33a` | outputs 目录重构为 `outputs/<key>` 子目录结构 |
| `da1f5af6` | HTML 预览改用 Blob URL，增强兼容性 |

### 技能管理

| 提交 | 说明 |
|------|------|
| `024e059c` | 技能目录支持文件树预览与启用/禁用切换（`.disabled` 标记文件） |
| `7bccbf0f` | 技能详情支持标签页切换（基础信息 / Skill 浏览） |

### MCP 增强

| 提交 | 说明 |
|------|------|
| `7c5bfe43` | MCP 启停免重启生效，WebUI 新增详情抽屉与开关 |
| `453a138e` | 修复 anyio cancel scope 泄漏与 MCP enabled 配置不生效 |

### 会话与消息体验

| 提交 | 说明 |
|------|------|
| `084aac14` | 消息气泡添加头像与时间戳 |
| `cd3f5343` | 历史消息压缩提示横幅 |
| `b72cc9cc` | 会话列表简化 updated_at 计算，转录回放固定基准时间戳 |

### 通道与实例管理

| 提交 | 说明 |
|------|------|
| `2eedb6f0` | WebUI 设置页通道状态区块，查看机器人详情与连接实例 |

### 其他

| 提交 | 说明 |
|------|------|
| `32225cdf` | 新增 GLM (智谱) 搜索提供商 |
| `9fbc6c6b` | nanobotx 批量操作（start/stop/restart 全部实例） |
| `609e7c73` | WebUI 支持文档上传 |
| `19dbe1ea` | 修复会话清理遗漏 outputs、markdown 表格渲染 |
| `6f71ff01` | 增强日志可观测性（统一格式、文件路径定位） |
| `71db2a8d` | agent 模板补充文件路径输出规范 |
| `d8a13b19` | workspace 目录结构索引文档 |
| `32258b17` | 版本号升至 0.2.3 |

---

## 二、fork `main` 有、当前分支没有（80+ 个提交）

### 安全修复

| 提交 | 说明 |
|------|------|
| `aa6c1bf3` | shell 命令链/注释绕过 allowPatterns 安全漏洞 |
| `2bf111f4` | 移除不安全的 shell 注释自动剥离 |
| `13c951aa` | exec login-shell 默认从 true 改为 false |

### Session 稳定性

| 提交 | 说明 |
|------|------|
| `463f5367` | 修复 session key 磁盘碰撞 |
| `00a907c4` | 修复 session storage key 与 WebUI 耦合 |
| `89dc34df` | 修复损坏的旧版 session 文件 |
| `cf2f5896` | 防止 save 写入旧版 lossy 路径 |
| `3ce77633` | 新增 `_decode_storage_key` 修复损坏文件 |

### 流式处理修复

| 提交 | 说明 |
|------|------|
| `6a27c262` / `3ca82ea8` | 修复流式/非流式工具调用 ID 重复 |
| `98dd883c` / `523bb928` | 修复 reasoning wrapper delta 缓冲与 thinking 标签规范化 |
| `070aed8a` | apply_final_call_ids 误操作非文件编辑工具导致 ID 损坏 |
| `d8601478` / `66fc5442` | stream-id delta 合并修复 |
| `35bd1be1` | 修复空 thinking marker 流式输出 |

### 新提供商

| 提交 | 说明 |
|------|------|
| `44817b75` | Kimi Coding 提供商 |
| `ddad6c5a` | OpenCode Zen / OpenCode Go 提供商 |
| `4beca25c` | GitHub Copilot Enterprise/GHE 自定义端点 |
| `44a5ed1b` | 提供商级别代理配置 |
| `ceae6d7b` | 自定义提供商 thinking style 配置 |

### MCP 改进

| 提交 | 说明 |
|------|------|
| `67ce6822` | MCP 工具图片作为 artifact 投递 |
| `246ea8ef` | MCP resource/prompt 受 enabledTools 控制 |
| `780093d0` / `bfc2a74e` / `f9b02496` | MCP URL 日志脱敏（凭证信息） |
| `21aa900d` | MCP 工具错误结果正确处理 |
| `b0258e8b` | 保留旧版插件工具错误 |

### WhatsApp 重构

| 提交 | 说明 |
|------|------|
| `2a9e288d` | 用 neonize 替换旧 bridge |
| `839d1ecf` | 支持已读回执（蓝色双勾） |
| `fbf96a35` / `bfb42466` | bridge 迁移兼容 |

### 微信通道修复

| 提交 | 说明 |
|------|------|
| `edada598` | 微信流式 LLM 调用 + 缓冲回复投递 |
| `735a2438` | 修复微信流式重试缓冲区 |

### WebUI 改进

| 提交 | 说明 |
|------|------|
| `2ec40442` | `$` 技能快捷方式 |
| `8df10020` | 优化提示栏 minimap |
| `5005bca3` / `194e9d5f` | 修复重连后卡住的流式状态 |
| `b14f82f4` | 防止 iOS Safari 输入框缩放 |
| `943191f0` | 修复代码块复制降级 |
| `c915e98c` | 修复多文件 apply_patch 编辑保留 |
| `28c8c89a` | 小米 MiMo WebM 转 WAV 以支持 ASR |

### Context / Dream / 上下文管理

| 提交 | 说明 |
|------|------|
| `6c880a66` / `f7b027a2` | 修复 Dream disabled 时 cursor 不推进导致 prompt 膨胀 |
| `3460ca3c` | 按上下文压力控制 microcompaction |
| `40282e3b` | 根据上下文窗口动态扩展 replay cap |
| `dacc6992` | 废弃 max messages 配置项 |

### 其他修复

| 提交 | 说明 |
|------|------|
| `e9289960` | Telegram 富文本改为 opt-in |
| `de4009ef` | heartbeat 排除已归档 session |
| `c66a0217` | 为 DDGS 客户端传递代理 |
| `851a0ff5` | subagent fail_on_tool_error 可配置 |
| `56443ac6` | API 绑定所有接口时强制 api_key 鉴权 |
| `ed483253` | API auth guard 回归修复 |
| `d9795973` | 安装向导在非交互终端自动跳过 |
| `8248d075` | 硬化为格式错误的 tool-call 防护 |
| `638af123` | 钉钉保留 richText 格式并设置超时 |
| `f6d1dba3` | cron 容忍不支持目录 fsync |
| `9354b80a` | CLI 向导显示搜索引擎（含 Keenable） |
| `319791cd` | 修复保存配置时 dream cron 丢失 |
| `58cce14a` | CLI 允许 OAuth 登录设置主提供商 |
| `bfbae5a7` | CLI 刷新 OAuth 提供商默认模型 |
| `3403b876` | WebUI 空闲 compaction 不计入 session 活跃度 |
| `840ba5af` | 简化 session 活跃度追踪 |
| `a6a489e0` | 收紧 session 活跃度清理逻辑 |
| `84935609` | 使用结构化工具错误结果 |
| `8d2c31eb` | WebUI 推导提供商模型目录类型 |
| `4726ca04` | 添加显式 restart mode |
| `d2da6df1` | v0.2.2 发布说明 |

---

## 总结

| 维度 | 当前分支 `geqin_v0.2.2` | fork `main` |
|------|--------------------------|-------------|
| 独有提交 | 24 | ~80 |
| 核心亮点 | 活动追踪、Plan 工具、交付物面板、技能管理、GLM 搜索 | 安全修复、session 修复、流式修复、Kimi/OpenCode、WhatsApp 重构 |
| 风险 | 缺少关键安全修复和稳定性补丁 | 缺少活动追踪和 Plan 工具等特性 |

建议将 `geqin/main` 合并到当前分支，优先关注 `aa6c1bf3`（shell 安全漏洞）和 `463f5367`（session key 碰撞）两个修复。
