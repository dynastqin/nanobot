---
name: nanobot-release
description: 构建 nanobot wheel 并发布到私有 PyPI 私服。当用户说"发布"、"发版"、"release"、"publish"、"构建 wheel"、"更新版本"、"升级版本号"时触发。
---

# Nanobot 发版与发布

构建 nanobot wheel 并推送到私有 PyPI 源。

## 前置要求

- Python 3.11+
- `uv`（用于构建和发布，`uv build` 会自动处理构建环境隔离，无需手动安装 hatch）
- `bun` 或 `npm`（构建前端，由 `hatch_build.py` 自动触发）
- 私服地址：`http://172.25.254.133:8080/`（pypiserver）
- 管理接口：`http://172.25.254.133:8081/cleanup`（包清理）

## 发版流程

### 步骤 1：确认版本号

当前版本号在 `pyproject.toml` 中：

```toml
[project]
name = "nanobot-ai"
version = "<current>"  # <-- 这里
```

使用 **AskUserQuestion** 询问用户要升级到的版本号，同时告知当前版本：

```
问题："当前版本是 X.X.X，要升级到哪个版本？"
选项：
- "X.X.X"（修订号 +1）
- "X.X.X"（次版本号 +1）
- "版本不变"（保持当前版本，仅重新构建发布）
- 其他（用户自行输入）
```

用户确认后，若版本号有变化则编辑 `pyproject.toml` 中的 `version` 字段；若选择"版本不变"则跳过版本号修改。

### 步骤 2：构建

> **不要用 `hatch build`**：hatch CLI 需要额外安装，且会下载大量依赖。直接用 `uv build`，它会自动读取 `pyproject.toml` 中的 hatchling 构建后端并创建隔离环境。

```bash
uv build
```

`hatch_build.py` 构建钩子会在构建时自动执行前端构建并打入 wheel。

产物在 `dist/` 下：
```
nanobot_ai-<version>-py3-none-any.whl
nanobot_ai-<version>.tar.gz
```

### 步骤 3：清理旧包

上传同名（同版本）包前需要先清理旧包，避免冲突：

```bash
curl --location --request POST 'http://172.25.254.133:8081/cleanup?dry_run=0' \
  --header 'Authorization: Bearer v5_pipyserver' \
  --header 'Content-Type: application/json' \
  -d '{"filename": "nanobot_ai-<version>-py3-none-any.whl"}'
```

> **注意**：全新版本（从未上传过）会返回 `{"code":40401,"message":"file not found"}`，这是正常的，无需处理，直接进入下一步上传。

> `dry_run=1` 可预览将被清理的包，`dry_run=0` 实际执行清理。

### 步骤 4：上传

```bash
uv publish --publish-url http://172.25.254.133:8080/ \
  --username admin --password Yowant2025 \
  dist/nanobot_ai-<version>-py3-none-any.whl
```

### 步骤 5：用户端升级

```bash
pip install --upgrade --extra-index-url http://pypi.yowant.link:8080/simple/ --trusted-host pypi.yowant.link nanobot-ai
```

> **版本未变时**：`--upgrade` 会跳过相同版本，改用 `--force-reinstall --no-deps` 只重装 nanobot-ai，不波及依赖：
> ```bash
> pip install --force-reinstall --no-deps --extra-index-url http://pypi.yowant.link:8080/simple/ --trusted-host pypi.yowant.link nanobot-ai
> ```

## 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `hatch: command not found` | hatch CLI 未安装，`uv pip install hatch` 会下载大量依赖（virtualenv、uv 本体等） | 直接用 `uv build`，它内置 PEP 517 构建能力 |
| cleanup 返回 404 | 全新版本从未上传过，自然找不到旧包 | 忽略 404，继续上传即可 |
| 构建时前端未更新 | `hatch_build.py` 旧版会跳过已有 dist | 已改为每次强制重建，不再需要手动干预 |

## 关键点

| 项目 | 说明 |
|------|------|
| 版本号 | `pyproject.toml` 第 3 行 `version` 字段 |
| 前端分发 | `nanobot/web/dist/` 通过 `force-include` 打入 wheel |
| 构建钩子 | `hatch_build.py` 在构建时自动构建前端（有缓存则跳过） |
| 构建工具 | 使用 `uv build`，不用 `hatch build` |
| 私服上传 | `uv publish` 推送到 `http://172.25.254.133:8080/` |
| 包清理 | 同版本包需先通过 cleanup API 清理（`172.25.254.133:8081`） |
| 用户安装 | `pip install --extra-index-url http://pypi.yowant.link:8080/simple/ nanobot-ai` |
