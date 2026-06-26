---
name: nanobot-release
description: 构建 nanobot wheel 并发布到私有 PyPI 私服。当用户说"发布"、"发版"、"release"、"publish"、"构建 wheel"、"更新版本"、"升级版本号"时触发。
---

# Nanobot 发版与发布

构建 nanobot wheel 并推送到私有 PyPI 源。

## 前置要求

- Python 3.11+
- `hatch`（`pip install hatch`）
- `uv`（用于发布）
- `bun` 或 `npm`（构建前端，由 `hatch_build.py` 自动触发）
- 私服地址：`http://172.25.254.133:8080/`（pypiserver）
- 管理接口：`http://172.25.254.133:8081/cleanup`（包清理）

## 发版流程

### 步骤 1：确认改动已完成

```bash
git status
git diff
```

如有未提交的改动，先提交。

### 步骤 2：确认版本号

当前版本号在 `pyproject.toml` 中：

```toml
[project]
name = "nanobot-ai"
version = "<current>"  # <-- 这里
```

使用 **AskUserQuestion** 询问用户要升级到的版本号，同时告知当前版本：

```
问题："当前版本是 0.2.2，要升级到哪个版本？"
选项：
- "0.2.3"（修订号 +1）
- "0.3.0"（次版本号 +1）
- 其他（用户自行输入）
```

用户确认后，编辑 `pyproject.toml` 中的 `version` 字段：

```bash
sed -i '' 's/^version = ".*"/version = "<new-version>"/' pyproject.toml
```

### 步骤 3：构建

`hatch_build.py` 构建钩子会在 `hatch build` 时自动执行前端构建并打入 wheel。

```bash
hatch build
```

产物在 `dist/` 下：
```
nanobot_ai-<version>-py3-none-any.whl
```

### 步骤 4：清理旧包

上传同名（同版本）包前需要先清理旧包，避免冲突：

```bash
curl --location --request POST 'http://172.25.254.133:8081/cleanup?dry_run=0' \
  --header 'Authorization: Bearer v5_pipyserver' \
  --header 'Content-Type: application/json' \
  -d '{"filename": "nanobot_ai-<version>-py3-none-any.whl"}'
```

如果还有其他版本的旧包想清理，同理按 filename 逐个清理。

> `dry_run=1` 可预览将被清理的包，`dry_run=0` 实际执行清理。

### 步骤 5：上传

```bash
uv publish --publish-url http://172.25.254.133:8080/ \
  --username admin --password Yowant2025 \
  dist/nanobot_ai-<version>-py3-none-any.whl
```

### 步骤 6：用户端升级

```bash
pip install --upgrade --extra-index-url http://pypi.yowant.link:8080/simple/ nanobot-ai
```

## 关键点

| 项目 | 说明 |
|------|------|
| 版本号 | `pyproject.toml` 第 3 行 `version` 字段 |
| 前端分发 | `nanobot/web/dist/` 通过 `force-include` 打入 wheel |
| 构建钩子 | `hatch_build.py` 在 `hatch build` 时自动构建前端 |
| 私服上传 | `uv publish` 推送到 `http://172.25.254.133:8080/` |
| 包清理 | 同版本包需先通过 cleanup API 清理（`172.25.254.133:8081`） |
| 用户安装 | `pip install --extra-index-url http://pypi.yowant.link:8080/simple/ nanobot-ai` |
