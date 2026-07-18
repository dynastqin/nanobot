# CloudDisk (云盘) Implementation Plan

**Date:** 2026-07-18 | **Status:** Ready for implementation

## Context

Add instance-scoped persistent file storage ("CloudDisk") to nanobot framework. This merges the existing `media/` directory into a unified clouddisk layer, adds `disk` parameter to agent file tools, and builds a complete WebUI file manager (CloudDisk Tab + FileSelector modal + Save buttons).

36 rounds of domain modeling decisions captured in:
- `docs/plan/clouddisk-domain-model.md` (nanobot-app)
- `CONTEXT.md`, `docs/adr/0001-*.md`, `docs/adr/0002-*.md` (nanobot-code/nanobot)

## Implementation Phases

### Phase 1: Config + Paths (foundation, no deps)

**1.1 `nanobot/config/schema.py`** — Add `CloudDiskConfig`
```python
class CloudDiskConfig(Base):
    enabled: bool = True
    root_dir: str = ""       # empty = auto-derive from instance data dir
    quota_mb: int = 10240    # 10GB soft quota
    max_file_size_mb: int = 100
```
Add to root `Config`: `clouddisk: CloudDiskConfig = Field(default_factory=CloudDiskConfig)`

**1.2 `nanobot/config/paths.py`** — Add path helpers
```python
def get_clouddisk_dir() -> Path:
    return get_runtime_subdir("clouddisk")

def ensure_clouddisk_dirs() -> Path:
    root = get_clouddisk_dir()
    ensure_dir(root / "聊天归档")
    return root
```

### Phase 2: CloudDisk Backend Core

**2.1 NEW `nanobot/webui/clouddisk_api.py`** — All backend logic

- `CloudDiskIndex` — manages `.meta.json` (read/write/add/remove, atomic write via temp+rename)
- `CloudDiskOps` — file operations: list, upload, delete, move, info, quota, check_quota
- `archive_session_media(session_id, media_files, root)` — copy media to `聊天归档/<session-id>/`
- `CloudDiskGateway` — injectable singleton wrapping CloudDiskOps, exposes `get_root()`, media archive hook
- `resolve_clouddisk_path(path, root)` — boundary-enforced path resolution (prevents `..` traversal)

**2.2 `nanobot/webui/gateway_services.py`** — Wire CloudDiskGateway

- In `build_gateway_services()`: instantiate `CloudDiskGateway` if `config.clouddisk.enabled`
- Pass it to `GatewayHTTPHandler.__init__` as new `clouddisk` parameter
- Add `clouddisk` field to `GatewayServices` dataclass

**2.3 `nanobot/webui/ws_http.py`** — Add CloudDisk API routes

- Add `clouddisk: CloudDiskGateway | None` to `GatewayHTTPHandler.__init__`
- Add `_dispatch_clouddisk_routes()` in dispatch cascade (after media, before automations)
- 7 handlers: `_handle_clouddisk_list`, `_handle_clouddisk_upload`, `_handle_clouddisk_download`, `_handle_clouddisk_delete`, `_handle_clouddisk_move`, `_handle_clouddisk_info`, `_handle_clouddisk_quota`
- Auth via `self.check_api_token(request)` (no session key needed — clouddisk is instance-scoped)

### Phase 3: Agent Tools — `disk` parameter

**3.1 `nanobot/agent/tools/path_utils.py`** — Add `resolve_clouddisk_path()`
```python
def resolve_clouddisk_path(path: str, clouddisk_root: Path) -> Path:
    cleaned = path.lstrip("/")
    resolved = (clouddisk_root / cleaned).resolve()
    try:
        resolved.relative_to(clouddisk_root.resolve())
    except ValueError:
        raise PermissionError(f"Path {path} is outside clouddisk root")
    return resolved
```

**3.2 `nanobot/agent/tools/filesystem.py`** — Modify `_FsTool` base + all 4 tools

- `__init__`: add `clouddisk_root: Path | None = None`
- `create(ctx)`: extract clouddisk_root from config (if enabled)
- `_resolve_read(path, disk="workspace")`, `_resolve_write(path, disk="workspace")`: branch to `resolve_clouddisk_path()` when `disk="cloud"`
- Each tool's `execute()`: accept `disk` kwarg, pass to resolve methods
- Each tool's `@tool_parameters`: add `disk=StringSchema("workspace", enum=["workspace", "cloud"])`

**3.3 `nanobot/agent/tools/apply_patch.py`** — Same `disk` param addition

### Phase 4: Session Media Auto-Archive

**4.1 `nanobot/webui/media_gateway.py`** — Hook into media staging

- In `sign_or_stage_media_path()`: if clouddisk enabled, also copy to `clouddisk/聊天归档/<session-id>/`
- Non-blocking: fire-and-forget, log warning on failure, never affect the agent turn

### Phase 5: Frontend Types + API Layer

**5.1 `webui/src/lib/types.ts`** — Add CloudDisk types
```typescript
CloudDiskFileItem { name, path, type, size, created_at, source_session_id }
CloudDiskListPayload { folder, files }
CloudDiskQuotaPayload { used_mb, quota_mb, file_count }
```

**5.2 `webui/src/lib/api.ts`** — Add API functions
- `fetchCloudDiskList(token, folder)` → `GET /api/clouddisk/list`
- `uploadCloudDiskFile(token, folder, file)` → `POST /api/clouddisk/upload`
- `cloudDiskDownloadUrl(path)` → URL builder
- `deleteCloudDiskFile(token, path)` → `POST /api/clouddisk/delete`
- `moveCloudDiskFile(token, from, to)` → `POST /api/clouddisk/move`
- `fetchCloudDiskInfo(token, path)` → `GET /api/clouddisk/info`
- `fetchCloudDiskQuota(token)` → `GET /api/clouddisk/quota`

### Phase 6: Frontend CloudDisk View (new components)

All new files under `webui/src/components/clouddisk/`:

| File | Purpose |
|------|---------|
| `CloudDiskView.tsx` | Top-level dual-pane layout (folder tree + file list) |
| `CloudDiskFolderTree.tsx` | Recursive folder tree, left pane |
| `CloudDiskFileList.tsx` | File grid/list with view toggle, right pane |
| `CloudDiskFileItem.tsx` | Single file row or grid card with context menu |
| `CloudDiskQuotaBar.tsx` | Quota usage bar at top |
| `CloudDiskToolbar.tsx` | Upload, new folder, delete, grid/list toggle, breadcrumbs |
| `CloudDiskUploadDialog.tsx` | Upload with drag-and-drop |
| `FileSelectorModal.tsx` | Modal for chat attachment file picking |

### Phase 7: Frontend Integration

**7.1 `webui/src/App.tsx`**
- Add `"clouddisk"` to `ShellView` type
- Add `#/clouddisk` route in `readShellRoute()` + `shellRouteHash()`
- Add `onOpenCloudDisk` callback, pass to Sidebar
- Render `CloudDiskView` when `view === "clouddisk"`

**7.2 `webui/src/components/Sidebar.tsx`**
- Add CloudDisk nav button (HardDrive icon) between Automations and Archived
- Add `onOpenCloudDisk` + `activeUtility` prop

**7.3 `webui/src/components/FileReferenceChip.tsx`**
- Add `onSaveToCloudDisk?: (path: string) => void` prop
- Render small cloud/save icon on hover when clouddisk is enabled

**7.4 `webui/src/components/FilePreviewPanel.tsx`**
- Add "Save to CloudDisk" button in toolbar alongside ArtifactShareButton
- Opens folder picker → user confirms target → copy file → toast

**7.5 `webui/src/components/thread/ThreadComposer.tsx`**
- Add CloudDisk attachment button (HardDrive icon) alongside existing attachment buttons
- Click → opens `FileSelectorModal`
- Small files (<100KB): inject content inline into message
- Large files (≥100KB): inject file reference (path + metadata)

**7.6 `webui/src/components/thread/ThreadShell.tsx`**
- Pass clouddisk-related props through to ThreadComposer and ThreadMessages

### Phase 8: i18n + Agent Prompt

**8.1 `webui/src/i18n/en/common.json` + `zh-CN/common.json`**
- Keys: `sidebar.clouddisk`, `clouddisk.title`, `clouddisk.upload`, `clouddisk.delete`, `clouddisk.saveToCloud`, etc.

**8.2 `nanobot/templates/AGENTS.md`** (template used by `nanobot onboard`)
- Add CloudDisk usage section with `disk="cloud"` usage examples and guidelines

## Implementation Order

```
Phase 1 (config+paths) → Phase 2 (backend core) → Phase 3 (agent tools)
                                                  → Phase 5 (frontend types+api)
Phase 3 + Phase 5 → Phase 6 (frontend components)
Phase 2 → Phase 4 (auto-archive)
Phase 6 → Phase 7 (frontend integration) → Phase 8 (i18n+prompt)
```

Phases 3 and 5 can run in parallel (independent codebases). Phase 6 depends on Phase 5 for types.

## Key Files Modified (11 files)

| File | Change |
|------|--------|
| `nanobot/config/schema.py` | Add `CloudDiskConfig`, wire into `Config` |
| `nanobot/config/paths.py` | Add `get_clouddisk_dir()`, `ensure_clouddisk_dirs()` |
| `nanobot/webui/gateway_services.py` | Create + inject `CloudDiskGateway` |
| `nanobot/webui/ws_http.py` | Add clouddisk route dispatch + 7 handlers |
| `nanobot/agent/tools/filesystem.py` | `disk` param on `_FsTool` + 4 tools |
| `nanobot/agent/tools/path_utils.py` | Add `resolve_clouddisk_path()` |
| `nanobot/agent/tools/apply_patch.py` | `disk` param |
| `nanobot/webui/media_gateway.py` | Auto-archive hook in `sign_or_stage_media_path` |
| `webui/src/App.tsx` | CloudDisk ShellView + routing |
| `webui/src/components/Sidebar.tsx` | CloudDisk nav button |
| `webui/src/lib/api.ts` | 7 clouddisk API functions |
| `webui/src/lib/types.ts` | CloudDisk TypeScript types |
| `webui/src/components/FileReferenceChip.tsx` | Save to CloudDisk button |
| `webui/src/components/FilePreviewPanel.tsx` | Save to CloudDisk button |
| `webui/src/components/thread/ThreadComposer.tsx` | CloudDisk attachment button |

## Key Files Created (11 files)

| File | Purpose |
|------|---------|
| `nanobot/webui/clouddisk_api.py` | CloudDiskIndex, CloudDiskOps, CloudDiskGateway |
| `webui/src/components/clouddisk/CloudDiskView.tsx` | Dual-pane main view |
| `webui/src/components/clouddisk/CloudDiskFolderTree.tsx` | Folder tree panel |
| `webui/src/components/clouddisk/CloudDiskFileList.tsx` | File list/grid panel |
| `webui/src/components/clouddisk/CloudDiskFileItem.tsx` | File row/card |
| `webui/src/components/clouddisk/CloudDiskQuotaBar.tsx` | Quota display |
| `webui/src/components/clouddisk/CloudDiskToolbar.tsx` | Actions toolbar |
| `webui/src/components/clouddisk/CloudDiskUploadDialog.tsx` | Upload dialog |
| `webui/src/components/clouddisk/FileSelectorModal.tsx` | Chat file picker |
| `tests/test_clouddisk.py` | Backend unit tests |
| `tests/test_clouddisk_api.py` | API endpoint tests |

## Verification

1. **Backend unit tests**: `uv run pytest tests/test_clouddisk.py tests/test_clouddisk_api.py -v`
2. **Agent tool tests**: Verify `disk="cloud"` reads/writes/list from clouddisk root; verify `disk="workspace"` unchanged
3. **API smoke test**: `curl http://127.0.0.1:<gateway_port>/api/clouddisk/quota -H "Authorization: Bearer <token>"`
4. **Frontend build**: `cd webui && bun run build` (verifies no TS errors)
5. **E2E**: Start gateway → open WebUI → click CloudDisk tab → upload file → open chat → attach clouddisk file → verify agent receives it
