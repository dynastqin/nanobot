# ADR 0001: Merge media/ into clouddisk/

**Date:** 2026-07-18
**Status:** Accepted

## Context

nanobot currently has a `media/` directory that stores chat-generated images and videos. These files are served via HMAC-signed URLs (`/api/media/<sig>/<payload>`) and organized by channel (`media/websocket/`) or by date (`media/generated/YYYY-MM-DD/`).

The CloudDisk feature introduces a new persistent file storage layer at `clouddisk/`. Without intervention, nanobot would have two parallel file storage systems: `media/` (auto-managed, transient) and `clouddisk/` (user-managed, persistent).

## Decision

**Merge `media/` into `clouddisk/`.** CloudDisk becomes the single file persistence layer for all files in a nanobot instance.

- Chat media files are written directly to `clouddisk/聊天归档/<session-id>/` in real time (no intermediate `media/` staging).
- The HMAC-signed URL mechanism is preserved and extended to serve CloudDisk media files for preview in the CloudDisk Tab.
- Chat message references to media use `file-preview` API when embedded in conversation context.
- The `media/` directory and its associated code paths are removed.

## Alternatives Considered

1. **Keep separate:** `media/` stays as auto-managed chat cache, `clouddisk/` as user-managed storage. Rejected — two file systems confuse users ("which one has my file?"), and the boundary between "chat media" and "cloud disk file" is artificial.
2. **CloudDisk references media:** media/ stays but appears as a virtual read-only folder in CloudDisk. Rejected — adds indirection without reducing complexity.

## Consequences

- **Positive:** Single source of truth for all files. Users see everything in one place. Chat media is immediately available in CloudDisk without a separate "save" action.
- **Negative:** CloudDisk root gets populated with auto-generated session directories that some users may not want. Mitigated by the `聊天归档/` top-level container.
- **Risk:** Legacy instances upgrading from a version with `media/` need migration handling. **Accepted** because this is a new system with no legacy data.
- **Implementation cost:** Media serving code (`media_api.py`, `media_gateway.py`) must be refactored to route through CloudDisk paths instead of `media/` paths.
