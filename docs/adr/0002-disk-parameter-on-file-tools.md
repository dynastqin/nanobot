# ADR 0002: Extend existing file tools with disk parameter

**Date:** 2026-07-18
**Status:** Accepted

## Context

Agent tools (`read_file`, `write_file`, `edit_file`, `list_dir`, `apply_patch`) currently operate exclusively on the session workspace directory. The CloudDisk feature requires agents to also read, write, list, and edit files in the CloudDisk.

Two approaches were considered:
1. Create a parallel set of CloudDisk-specific tools (`clouddisk_read`, `clouddisk_write`, etc.)
2. Add a `disk` parameter to the existing tools

## Decision

**Add a `disk` parameter to the existing five file tools.** The parameter is an enum: `"workspace"` (default) or `"cloud"`. Each tool internally routes the operation to the appropriate root directory based on this parameter.

## Rationale

- **Cognitive load:** The agent already understands `read_file`/`write_file` semantics. A `disk` parameter is a small delta; five new tool names are a large delta.
- **Backward compatibility:** Default `"workspace"` means existing agent behavior is unchanged. Sessions that never mention cloud disk never trigger cloud disk operations.
- **Implementation simplicity:** Each tool adds a path prefix switch at the boundary — `workspace` maps to the session workspace root, `cloud` maps to `<instance>/clouddisk/`. The existing path resolution and security boundary enforcement extend naturally.

## Alternatives Considered

1. **Separate tool set (clouddisk_read, etc.):** Rejected — tool count inflation (5→10), agent must learn which set to use in which context, harder to refactor if a third storage target is added later.
2. **Virtual path prefix (`/cloud/...`):** Rejected — mixes routing with path semantics, makes it ambiguous whether `/cloud/report.md` is a file in a workspace folder named "cloud" or a cloud disk file. Enum parameter is unambiguous.

## Consequences

- **Positive:** Clean, minimal API surface change. Agent prompt can simply say "Use disk='cloud' when the user asks about cloud disk files."
- **Negative:** Each tool implementation gains a conditional branch for path resolution. The `_FsTool` base class or path utilities must be aware of the CloudDisk root.
- **Constraint:** The CloudDisk root must be discoverable at tool runtime. This requires the CloudDisk config (or derived path) to be accessible from the tool execution context, likely via the existing `ToolWorkspace` / ContextVar mechanism.
