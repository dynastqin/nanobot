# WebUI 文档上传支持

## Context

WebUI 的聊天附件系统目前只支持 4 种图片格式（png/jpeg/webp/gif）。后端的 `extract_documents()` 已完整支持 docx/pdf/xlsx/pptx 等文档的文本提取，但前端 MIME 白名单和 WebSocket 入口校验都将文档拒之门外（提示 "Unsupported file type"）。本次改动打通前后端，让 WebUI 能上传所有后端已支持的文档类型。

## 修改文件清单

### 前端

| 文件 | 改动说明 |
|------|----------|
| `webui/src/hooks/useDocuments.ts` | **新建** — 文档附件生命周期 hook（类 useAttachedImages，但用 FileReader 直接 base64 编码，不走 Worker） |
| `webui/src/hooks/useAttachedImages.ts` | 新增 `DOCUMENT_MIMES` 导出集合 + `isDocumentMime()` 工具函数供外部复用 |
| `webui/src/hooks/useClipboardAndDrop.ts` | `extractImageFilesFromPaste`/`extractImageFilesFromDrop` 改为同时提取文档类型文件 |
| `webui/src/components/thread/ThreadComposer.tsx` | 更新 `ACCEPT_ATTR`；拆分文件为图片/文档分别入队；submit 合并两者到 `media[]`；更新 i18n key |
| `webui/src/i18n/locales/*/common.json` | 更新 `imageRejected.*` 措辞为文件通用；新增 `attachFile` key（en/zh-CN/zh-TW/ja/ko/fr/es/vi/id 共 9 个文件） |

### 后端

| 文件 | 改动说明 |
|------|----------|
| `nanobot/channels/websocket.py` | 新增 `_DOCUMENT_MIME_ALLOWED` + `_MAX_DOCUMENT_BYTES` (50 MB) + `_MAX_DOCUMENTS_PER_MESSAGE` (10)；`_save_envelope_media` 增加文档计数和 size 分支 |

## 关键设计决策

1. **文档编码方式**：使用 `FileReader.readAsDataURL()` 直接生成 `data:<mime>;base64,...` URL，不走 `imageEncode.worker.ts`（文档不需要 canvas 归一化）。
2. **独立 hook vs 合并 hook**：新建 `useDocuments` hook，与 `useAttachedImages` 并存。原因：`useAttachedImages` 内部类型（`AttachedImage`）、Worker 管道和命名都强绑定图片，拆分后各自职责清晰，改动面小。
3. **WebSocket 消息格式不变**：文档复用 `OutboundMedia { data_url, name }` 结构，和现有图片/视频走同一 `media[]` 数组。后端 `save_base64_data_url()` 已通过 `mimetypes.guess_extension()` 处理任意 MIME 类型，无需修改。
4. **后端 extract_documents() 已就绪**：`loop.py` 的 `_prepare_message_media()` 会在 agent 处理前自动对非图片 media 调用文本提取，无需改动。

## 支持的文档 MIME 类型

```
application/pdf
application/vnd.openxmlformats-officedocument.wordprocessingml.document  (.docx)
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet         (.xlsx)
application/vnd.openxmlformats-officedocument.presentationml.presentation (.pptx)
text/plain, text/markdown, text/csv
application/json, application/xml, text/html
text/yaml, application/x-yaml
application/toml, text/x-toml
text/x-ini, text/x-config
```

## 限额

| 类型 | 条数上限/消息 | 文件大小上限 |
|------|-------------|------------|
| 图片 | 4 | 8 MB (后端硬限制) |
| 视频 | 1 | 20 MB |
| 文档 | 10 | 50 MB |

## 验证步骤

1. **构建前端**：`cd webui && bun run build`，确认无 TypeScript 错误
2. **运行前端测试**：`cd webui && bun run test`，更新 `thread-composer-attach.test.tsx` 等测试以覆盖文档场景
3. **运行后端测试**：`pytest tests/channels/test_websocket.py -v`（如果存在），验证 `_save_envelope_media` 的文档分支
4. **手动 E2E**：启动 `nanobot gateway`，在 WebUI 中上传 .docx/.pdf/.xlsx 文件，确认：
   - 文件选择器能看到文档类型
   - 拖拽/粘贴文档不报 "Unsupported file type"
   - 发送后 agent 能提取文档文本并回复内容相关问题
   - 同时上传图片+文档混合附件正常工作
