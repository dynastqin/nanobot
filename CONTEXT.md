# CONTEXT.md

CloudDisk feature domain glossary for the nanobot framework.

## Entities

| Term | Definition |
|------|-----------|
| **CloudDisk** (云盘) | Instance-scoped persistent file storage. Each nanobot instance has exactly one CloudDisk, rooted at `<instance>/clouddisk/`. Survives session boundaries. |
| **CloudDiskFile** (云盘文件) | A file persistently stored in the CloudDisk. Has metadata (name, size, type, created_at, source_session_id). Max size 100MB. Any file type allowed. |
| **CloudDiskFolder** (云盘文件夹) | A directory within the CloudDisk, forming a hierarchical tree. Users create, rename, move, and delete folders freely. |
| **ChatArchive** (聊天归档) | The pre-created top-level folder `聊天归档/` where session media files are automatically archived. |
| **SessionArchive** (会话归档) | A subdirectory `聊天归档/<session-id>/` holding all media files produced during a single session. Created automatically when the first media file is generated. |

## Value Objects

| Term | Definition |
|------|-----------|
| **DiskTarget** | Enum: `"workspace"` or `"cloud"`. A parameter on agent file tools that routes the operation to either the session workspace or the CloudDisk. Defaults to `"workspace"`. |
| **FileMetadata** | JSON record in `.meta.json` with fields: `name` (string), `size` (bytes, int), `type` (MIME type, string), `created_at` (ISO 8601, string), `source_session_id` (string or null). |
| **Quota** (配额) | Soft storage limit for the CloudDisk, default 10GB. Exceeding it triggers a UI reminder but does not block writes. Configured as `clouddisk.quota_mb`. |

## UI Components

| Term | Definition |
|------|-----------|
| **CloudDiskTab** (云盘标签页) | A primary navigation item in the WebUI sidebar. Opens a full-page dual-pane view: folder tree (left) + file list (right). File list supports toggling between list view and grid view. |
| **FileSelector** (文件选择器) | A modal/dialog launched from the chat input attachment button. Browses the CloudDisk folder tree, selects a file, and sends it to the current conversation. |
| **SaveToCloudDisk** (保存到云盘) | An action available on (a) message bubble file references and (b) the FilePreviewPanel toolbar. Copies a workspace file into a user-chosen CloudDisk folder. Supports renaming before save; prompts on name conflict. |

## Infrastructure

| Term | Definition |
|------|-----------|
| **MetaIndex** (`.meta.json`) | A single JSON file at `clouddisk/.meta.json` indexing metadata for all files in the CloudDisk. Keyed by relative path. |
| **SignedURL** (签名URL) | HMAC-signed URL for serving CloudDisk media files (images, video) in the CloudDisk Tab preview. Same mechanism as the legacy `media/` signature scheme, reused for CloudDisk. |
| **CloudDiskAPI** | REST endpoints under `/api/clouddisk/`: `list`, `upload`, `download`, `delete`, `move`, `info`, `quota`. |

## Lifecycle Rules

- A CloudDisk is created when an instance is first started with `clouddisk.enabled=true`.
- Media files generated during a session are written directly into `clouddisk/聊天归档/<session-id>/` in real time.
- The legacy `media/` directory is subsumed by CloudDisk; no separate media storage exists when CloudDisk is enabled.
- Agent tools default to `disk="workspace"`; CloudDisk operations require explicit user intent (e.g., "save this to cloud disk" or selecting a cloud disk file in the UI).
