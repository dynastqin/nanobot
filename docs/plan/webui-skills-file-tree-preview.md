# Plan: Skills Detail - File Tree + Preview

## Context

Currently the Skills detail sheet shows a `RawInstructionsBlock` — a collapsible `<details>` section that dumps the full `SKILL.md` content in a `<pre>` block. The user wants to replace this with a file directory tree (left sidebar) + file preview (right panel) layout, exactly like the existing session Files tab (`FilesTab` in `SessionDrawer.tsx`).

A skill is a directory containing `SKILL.md` plus optional assets (scripts, data files, images, etc.). Showing all files in a browsable tree is more useful than just dumping the markdown.

## Approach

Reuse the existing pattern from `SessionDrawer.tsx`'s `FilesTab`: extract `FileTreeNode` to a shared component, use the existing `FilePreviewContent` for rendering, and add backend endpoints for skill file listing and preview.

## Changes

### 1. Backend — `nanobot/webui/skills_api.py`

Add two new functions:

- **`webui_skill_files(workspace_path, name, disabled_skills)`** — resolves the skill directory (workspace skills first, then builtin), recursively builds a file tree JSON matching the `WorkspaceFilesPayload` shape. Returns `{ tree, path, display_path }`.
- **`webui_skill_file_preview(workspace_path, name, file_path, disabled_skills)`** — reads a file within the skill directory, returns `{ path, display_path, language, content, size, truncated }` like `FilePreviewPayload`.

### 2. Backend — `nanobot/webui/ws_http.py`

Add two new routes:
- `GET /api/webui/skills/<name>/files` → `_handle_webui_skill_files`
- `GET /api/webui/skills/<name>/file-preview?path=...` → `_handle_webui_skill_file_preview`

### 3. Frontend — `webui/src/lib/types.ts`

- Add `SkillDetail.files: WorkspaceFileNode` (the file tree, populated when available)
- No new types needed — reuse `WorkspaceFileNode` and `FilePreviewPayload`.

### 4. Frontend — `webui/src/lib/api.ts`

Add two new API functions:
- `fetchSkillFiles(token, name)` → `GET /api/webui/skills/<name>/files` → `WorkspaceFilesPayload`
- `fetchSkillFilePreview(token, name, path)` → `GET /api/webui/skills/<name>/file-preview?path=...` → `FilePreviewPayload`

### 5. Frontend — Extract `FileTreeNode` to shared component

Create `webui/src/components/FileTree.tsx` containing:
- `FileTreeNode` component (extracted from `SessionDrawer.tsx:709-794`)
- `formatSize` helper (extracted from `SessionDrawer.tsx:796-800`)
- `isPathUnderDir` helper (extracted from `SessionDrawer.tsx:703-707`)

Then update `SessionDrawer.tsx` to import from the shared component.

### 6. Frontend — `webui/src/components/settings/SkillsCatalogSettings.tsx`

In `SkillDetailSheet`, after the requirements section, replace `RawInstructionsBlock` with a `SkillFilesPanel` that mirrors the `FilesTab` layout:
- **Left side (tree)**: skill file tree using `FileTreeNode`, with resize handle
- **Right side (detail)**: file content preview using `FilePreviewContent`, with loading/error/unsupported states
- **Toolbar**: copy and download buttons (same as FilesTab)
- **Tree collapse**: button to toggle tree visibility
- Default selection: auto-select `SKILL.md` when files load

Remove the `RawInstructionsBlock` component (lines 260-288).

### 7. Frontend — i18n

- Remove i18n key `settings.skills.rawInstructions` and `settings.skills.rawInstructionsEmpty` from `en/common.json` and `zh-CN/common.json` (if no longer used elsewhere)
- Add new keys for: "Files" section title, tree collapse/expand, copy/download, select file prompt, loading/error/empty states, etc.

## Files to Modify

| File | Change |
|------|--------|
| `nanobot/webui/skills_api.py` | Add `webui_skill_files()` and `webui_skill_file_preview()` |
| `nanobot/webui/ws_http.py` | Add 2 routes + handlers |
| `webui/src/lib/types.ts` | Add `files` to `SkillDetail` |
| `webui/src/lib/api.ts` | Add `fetchSkillFiles()`, `fetchSkillFilePreview()` |
| `webui/src/components/FileTree.tsx` | **New** — extracted `FileTreeNode`, `formatSize`, `isPathUnderDir` |
| `webui/src/components/thread/SessionDrawer.tsx` | Import from `FileTree.tsx` instead of local definitions |
| `webui/src/components/settings/SkillsCatalogSettings.tsx` | Replace `RawInstructionsBlock` with file tree + preview panel |
| `webui/src/i18n/locales/en/common.json` | Update/add keys |
| `webui/src/i18n/locales/zh-CN/common.json` | Update/add keys |

## Verification

1. Run `ruff check nanobot/` and `pytest tests/ -k skill` to verify backend changes
2. Run `cd webui && bun run build` to verify frontend compiles
3. Start gateway with `nanobot gateway`, open skills settings, click a skill:
   - Verify file tree shows all skill files (SKILL.md + any other files)
   - SKILL.md is auto-selected and its content rendered in the preview panel
   - Clicking other files shows their preview
   - Tree collapse/expand works
   - Copy and download buttons work
   - Resize handle works
