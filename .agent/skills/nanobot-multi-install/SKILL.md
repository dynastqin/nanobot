---
name: nanobot-multi-install
description: 在 Linux 系统上安装和配置 nanobot 多实例运行环境，使用 nanobotx 管理工具。当用户请求在 Linux 上安装 nanobot、设置多个 nanobot 实例或配置多实例支持时使用。触发词包括"在 Linux 上安装 nanobot"、"设置 nanobot 多实例"、"配置 nanobot"、"Linux nanobot 安装"。
---

# Nanobot Linux 多实例安装指南

在 Linux 系统上安装 nanobot 并配置多实例支持，使用共享 venv 和 `nanobotx` 管理工具。此设置允许在单个 Linux 账户上运行多个隔离的 nanobot 实例（例如：工作、个人、测试）。适用于 Ubuntu、CentOS、Debian 等主流 Linux 发行版。

## 前置要求

- Linux 操作系统（支持 Ubuntu、CentOS、Debian 等发行版）
- Python 3.11 或更高版本
- `jq` 命令行 JSON 处理工具

## 安装概览

1. 询问用户安装目录
2. 创建共享 venv 并安装 nanobot
3. 安装 nanobotx 管理脚本
4. 验证安装

## 步骤 1：收集用户偏好

在开始安装之前，使用 AskUserQuestion 确定：

```
问题："nanobot 应该安装在哪里？"
选项：
- "$HOME/nanobot-app"（推荐）
- 自定义路径（用户指定）

将答案存储为本次会话的 NANOBOT_APP 环境变量。
```

## 步骤 2：安装系统依赖

检查 Python 版本并安装所需软件包：

```bash
# 验证 Python 版本
python3 --version  # 必须 >= 3.11

# 安装 jq（nanobotx 所需）
# Ubuntu/Debian:
sudo apt install -y jq

# CentOS/RHEL/Rocky Linux:
sudo yum install -y jq
# 或
sudo dnf install -y jq
```

如果 Python < 3.11，请指导用户先升级后再继续。

## 步骤 3：创建共享 venv 并安装 Nanobot

```bash
# 创建应用目录
export NANOBOT_APP="<user-specified-path>"
mkdir -p "$NANOBOT_APP"
cd "$NANOBOT_APP"

# 创建并激活虚拟环境
python3 -m venv app
source app/bin/activate

# 安装 nanobot-ai
pip install --upgrade pip
pip install nanobot-ai

# 验证安装
nanobot --version
which nanobot  # 应该指向 $NANOBOT_APP/app/bin/nanobot

# 退出 venv（nanobotx 将使用绝对路径）
deactivate
```

## 步骤 4：安装 nanobotx 管理工具

`nanobotx` 脚本管理多个 nanobot 实例，具有自动端口分配和生命周期管理功能。

### 安装脚本

将捆绑的脚本复制到安装目录：

```bash
# 从技能包复制 nanobotx 脚本
cp scripts/nanobotx "$NANOBOT_APP/nanobotx"
chmod +x "$NANOBOT_APP/nanobotx"

# 创建符号链接到用户的本地 bin 目录
mkdir -p ~/.local/bin
ln -sf "$NANOBOT_APP/nanobotx" ~/.local/bin/nanobotx
```

### 验证 PATH

确保 `~/.local/bin` 在 PATH 中：

```bash
which nanobotx  # 应显示 /home/<user>/.local/bin/nanobotx
nanobotx help
```

如果 `which nanobotx` 没有返回结果，添加到 PATH：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## 步骤 5：验证安装

运行以下命令确认设置：

```bash
# 检查 nanobotx 是否可用
nanobotx help

# 初始应显示空列表
nanobotx list
```

## 使用示例

### 创建实例

```bash
# 创建实例（端口自动分配：18791/18792/18793 用于 WebUI，8901/8902/8903 用于 API）
# 自动绑定 0.0.0.0 以支持外网访问，生成随机 UUID Token 用于 WebSocket 认证，
# 并注入占位 API Key 让 WebUI 可启动
nanobotx create work
nanobotx create home
nanobotx create test
```

> **注意**: `create` 会自动：
> - 将 gateway/api 绑定到 `0.0.0.0`（支持外网访问）
> - 生成随机 UUID 作为 WebSocket Token（`nanobotx list` 可查看）
> - 将 gateway health server 端口分离（webui_port + 10000），避免与 WebSocket 端口冲突
> - 注入 `sk-placeholder-change-in-webui` 占位 API Key。启动后通过 WebUI 替换为真实 Key 即可正常使用。

### 启动/停止实例

```bash
# 启动实例
nanobotx start work
nanobotx start home

# 检查状态
nanobotx list
# 输出（自动检测本机 IP，展示 WebUI Token）：
# NAME        WEBUI                         API      TOKEN                                  PID      STATUS
# work        http://172.25.231.228:18791    8901     a1b2c3d4-e5f6-7890-abcd-ef1234567890  12345    running
# home        http://172.25.231.228:18792    8902     1a2b3c4d-5e6f-7a8b-9c0d-ef1234567890  12346    running
# test        http://172.25.231.228:18793    8903     b2c3d4e5-f6a7-8901-bcde-f12345678901  -        stopped

# 查看单个实例的详细状态
nanobotx status work

# 停止实例
nanobotx stop work
```

### 访问 WebUI

```bash
# 绑定地址为 0.0.0.0，从本机或外网均可访问（自动检测本机 IP）
# 每个实例的 WebUI Token 可通过 nanobotx list 查看
# work:  http://<server-ip>:18791  (Token: nanobotx list | grep work)
# home:  http://<server-ip>:18792  (Token: nanobotx list | grep home)
# test:  http://<server-ip>:18793  (Token: nanobotx list | grep test)
```

> 首次启动前，`create` 已自动生成随机 UUID Token 并注入 websocket 配置（同时绑定 `0.0.0.0`），确保 gateway 和 websocket 不冲突。登录 WebUI 时需要提供 Token，同时需在 WebUI 中将占位 API Key 替换为真实 Key。

### 销毁实例

```bash
# 永久删除实例（会删除所有数据）
nanobotx destroy test
```

## 目录结构

安装后的目录结构如下(所有数据统一存放在 `$NANOBOT_APP/` 下):

```
$NANOBOT_APP/                       # 应用根目录(共享 venv + 所有实例数据)
├── app/                          # 共享虚拟环境
│   └── bin/nanobot               # nanobot CLI
├── nanobotx                        # 管理脚本
├── instances.json                  # 实例注册表(端口、进程ID)
├── logs/                         # 实例日志
│   ├── work.log
│   └── home.log
└── instances/                      # 实例数据根目录
    ├── work/
    │   ├── config.json             # 实例特定配置
    │   ├── workspace/              # 工作空间目录
    │   ├── logs/                   # 运行时日志
    │   ├── media/                  # 媒体文件
    │   ├── cron/                   # 定时任务
    │   └── webui/                  # WebUI 状态
    ├── home/
    │   └── （相同结构）
    └── test/
        └── （相同结构）
```

## 环境变量

- `NANOBOT_APP`: 安装根目录（默认：`$HOME/nanobot-app`）
- `NANOBOT_INSTANCES`: 实例数据根目录（默认：`$NANOBOT_APP/instances`）

这些变量可以在运行 `nanobotx` 之前设置来自定义。

## 已知限制

| 项目 | 说明 |
|------|------|
| CLI 历史共享 | `~/.nanobot/history/cli_history` 硬编码到 HOME 目录，所有实例共享（影响较小）|
| WhatsApp 桥接 | 此设置不包含 WhatsApp 桥接（需要 Node.js）|
| IM 账号唯一性 | 同一个 IM 账号（微信/Telegram）不能同时绑定到多个实例 |
| 升级行为 | 共享 venv 意味着 `pip install --upgrade nanobot-ai` 会升级所有实例 |
| 进程管理 | 使用 nanobotx 手动启动/停止；重启后不会自动启动（如需自动启动可添加 systemd 单元）|
| 端口分配 | 端口从 18791（WebUI）和 8901（API）开始自动递增；Health server 端口 = WebUI 端口 + 10000 |
| WebUI Token | 每个实例自动生成随机 UUID Token，用于 WebSocket 认证，可通过 `nanobotx list` 查看 |

## 故障排查

### 实例无法启动

```bash
# 查看日志
tail -f "$NANOBOT_APP/logs/<instance-name>.log"

# 验证配置
cat "$NANOBOT_APP/instances/<instance-name>/config.json"

# 检查端口是否已被占用
ss -tuln | grep <port-number>
```

### 找不到 nanobotx 命令

```bash
# 验证符号链接是否存在
ls -l ~/.local/bin/nanobotx

# 检查 PATH
echo $PATH | grep '.local/bin'

# 如需重新创建符号链接
ln -sf "$NANOBOT_APP/nanobotx" ~/.local/bin/nanobotx
```

### 找不到 jq 命令

```bash
# Ubuntu/Debian:
sudo apt install -y jq

# CentOS/RHEL/Rocky Linux:
sudo yum install -y jq
# 或
sudo dnf install -y jq
```

## 脚本

此技能包含：

- **scripts/nanobotx**: 多实例管理工具，提供 create、start、stop、destroy、list 和 status 命令