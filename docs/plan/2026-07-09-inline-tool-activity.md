# Interleaved Thinking + Tool Activity (v2)

> Replaces the earlier `2026-07-09-inline-tool-activity.md` plan, which kept a single "Thought for Xs" cluster and rendered tool cards beneath it — tools were never truly interleaved with thinking.

## Problem

Today every agent activity message (reasoning + tool traces + file edits + CLI/MCP runs) is bundled inside ONE collapsible "Thought for Xs" / "Working for Xs" tab in `AgentActivityCluster.tsx`. Users must click to expand it to see what tools ran. Even with the recent per-tool `ToolCallDetail` expand/collapse (commit `e082974b`), tools are still hidden behind the cluster's outer fold.

## Goal

Thinking and tool/shell calls must be **interleaved in real-time** in the chat scroll:

```
👤 User: help me debug X

🤔 Thought for 2s ▸          [collapsible]
🛠  search("X docs")         ▸ show details
🤔 Thought ▸                [collapsible]
🛠  edit_file(main.py)       ▸ show details
🤔 Thought for 1s ▸         [collapsible]
🤖 Here's what I did…
```

- Thinking content stays in collapsibles ("Thought for Xs")
- Tool/shell/CLI/MCP/file calls are always-visible inline cards
- They alternate in time order, streaming in live as the turn progresses
- Each tool card keeps its own expand/collapse for input/output (via existing `ToolCallDetail`)

## Approach A (Chosen) — Refactor inside `AgentActivityCluster` only

Keep `normalizeActivityTimeline` and `ThreadMessages` unchanged. The activity unit stays one `TurnUnit`. Inside `AgentActivityCluster.tsx`:

- Drop the outer "Thought for Xs" collapsible entirely
- Drop the shared `max-h-52` scrollport — the chat itself is the scrollport
- Iterate over `messages`, group consecutive reasoning, render each item as a sibling

### Grouping algorithm

New helper `groupActivityMessages(messages: UIMessage[]): ActivityGroup[]`:

```ts
type ActivityGroup =
  | { kind: "reasoning"; messages: UIMessage[] }   // consecutive reasoning-only chunks
  | { kind: "trace"; message: UIMessage };          // any kind==="trace" message (tools, CLI, MCP, or file edits)
```

- Consecutive `isReasoningOnlyAssistant` messages → merged into one `reasoning` group (so 3 thinking chunks in a row become ONE Thought block, not 3)
- Every `kind === "trace"` message → one `trace` group

Tool calls split reasoning groups, so `[r1, tool, r2, tool, r3]` correctly renders as 3 separate Thought blocks. Only truly consecutive reasoning (no tool between) merges.

### Render

```tsx
return (
  <div className="w-full">
    {groups.map((group, i) => {
      const isLast = i === groups.length - 1;
      switch (group.kind) {
        case "reasoning":
          return <ReasoningBlock key={...} messages={group.messages} streaming={isTurnStreaming && isLast} ... />;
        case "trace":
          return <TraceActivityCard key={...} message={group.message} active={isTurnStreaming && isLast} ... />;
      }
    })}
  </div>
);
```

### `ReasoningBlock` — per-block auto state

State:
```ts
const [userToggled, setUserToggled] = useState(false);
const [localOpen, setLocalOpen] = useState(false);
const [holdOpen, setHoldOpen] = useState(false);
```

Effective open:
```
autoOpen = (streaming || holdOpen) && isLast
open     = userToggled ? localOpen : autoOpen
```

- `streaming` — true if the group has any message with `reasoningStreaming=true`
- `isLast` — true if this is the last group in the cluster
- `holdOpen` — when `streaming` flips from true to false, hold open 900ms before collapse (matches the current cluster's completion-hold behavior, but per-block)

On click: `setUserToggled(true); setLocalOpen(!open);` — user override sticks.

### Duration label — per block

- While streaming: `Thinking for {{duration}}` (live, via `now` timer)
- After completion: `Thought for {{duration}}` (frozen)
- If duration rounds to 0s: `Thinking…` / `Thought` (matches current zero-length fallback)
- Computed from the group's own messages: `min(createdAt)` to `max(createdAt)` (or to `now` while streaming)

No aggregate turn-level duration.

### Trace cards

- `TraceActivityCard` replaces the existing `ActivityTraceTimeline` — same body (trace lines via `ActivityTraceRow`, CLI runs via `CliRunRow`, MCP runs via `McpRunRow`), but without the `ActivityGroup` section wrapper
- Always visible — no card-level collapsible wrapper
- Each row includes `ToolCallDetail` for expandable input/output params (already wired in `e082974b`)
- `active=true` when `isTurnStreaming && isLast` (drives icon pulse / spinner)
- The old `ActivityTraceTimeline` function is removed (its body lives inside `TraceActivityCard`)

### File edits handling

Two paths, matching today's behavior:

- **Mixed turn** (has reasoning or non-file traces): file edits are still collected globally via `collectFileEdits(messages)` → `summarizeFileEdits(...)` and rendered as a single trailing `FileEditGroup` below the per-message cards. This preserves today's dedup-by-path behavior and avoids cluttering the scroll with one card per edited file.
- **File-only turn** (`hasOnlyFileActivity` true): continues to use `FileEditFlatActivity` (unchanged) for the compact "Edited N files" rendering.

> Future option (out of scope): tie file edits to their source trace message and render inline. Defer until we see how the trailing-group layout feels.

### Removed from cluster

- `toggleOuter` / `outerExpanded` / `outerOpenLocal` / `userToggledOuter` — replaced by per-block state
- `activityScrollRef` / `activityContentRef` / `autoFollowActivityRef` / `scheduleActivityScrollToBottom` — removed (chat is the scrollport)
- `hasNonReasoningActivity` / aggregate `thoughtLabel` / aggregate `summary` — replaced by per-block labels
- `FileEditFlatActivity` — KEPT, only invoked for `hasOnlyFileActivity` (unchanged)

### Preserved edge cases

- **No activity** → `return null` (unchanged)
- **File-only activity** (`hasOnlyFileActivity`) → still uses `FileEditFlatActivity` for the compact "Edited N files" rendering
- **Trace with multiple tool calls** → still one card; each call is a row inside
- **Trace with CLI runs** → detected via `cliRunMapByTraceLine`, rendered as `CliRunRow`
- **Trace with MCP runs** → detected via `mcpRunMapByTraceLine`, rendered as `McpRunRow`
- **Mixed turn with file edits** → per-message cards interleaved with reasoning, then a trailing `FileEditGroup` (preserves today's global dedup)

### Interface unchanged

`ThreadMessages.tsx` continues to pass the same props to `AgentActivityCluster`: `messages`, `isTurnStreaming`, `hasBodyBelow`, `turnLatencyMs`, `cliApps`, `mcpPresets`, `onOpenFilePreview`, `onOpenLink`. No `ThreadMessages` or `activity-timeline` changes.

## Approach B (Fallback) — Split at the data layer

If Approach A doesn't deliver the desired UX (e.g., per-row avatar/timestamp issues, or per-item memoization becomes important), split at the data layer instead.

Modify `normalizeActivityTimeline` in `webui/src/lib/activity-timeline.ts` to emit finer-grained `TurnUnit`s:

```ts
type TurnUnit =
  | { type: "reasoning"; messages: UIMessage[]; turnLatencyMs?: number }
  | { type: "tool_trace"; message: UIMessage; turnLatencyMs?: number }
  | { type: "file_edit"; message: UIMessage; turnLatencyMs?: number }
  | { type: "message"; message: UIMessage };
```

Then `ThreadMessages.tsx` renders each as its own row.

**Pros over A:**
- True per-item chat rows (each is its own `TurnUnit`)
- Per-item `React.memo` becomes trivial
- Future-friendly for per-item actions (e.g., fork-from-tool-call, retry-one-tool)

**Cons:**
- Bigger refactor — touches `ThreadMessages`, `unitKeysForDisplay`, `currentActivityClusterIndices`, `assistantCopyFlags`, `buildConsecutiveFlags`
- Avatar/timestamp logic needs rework (likely: hide avatar on consecutive activity rows, show on first-of-role)
- Many more test updates
- Loses the "one agent turn section" grouping unless explicitly handled in `buildConsecutiveFlags`

Only fall back to B if A proves unworkable.

## Files Changed (Approach A)

| File | Action |
|------|--------|
| `webui/src/components/thread/AgentActivityCluster.tsx` | Major refactor. Add `groupActivityMessages`, `ReasoningBlock`, `TraceActivityCard`. Replace `ActivityTraceTimeline` with `TraceActivityCard` (drop `ActivityGroup` wrapper, otherwise same body). Remove outer fold UI, scrollport logic, aggregate labels. Keep all trace row / CLI / MCP / file-edit primitives and `FileEditFlatActivity` (unchanged, file-only path). |
| `webui/src/tests/agent-activity-cluster.test.tsx` | Rewrite. Drop "Thought for Xs" / "Working for Xs" header assertions. Add alternation, per-block auto-open, per-block hold-open, user-override, trace-card-always-visible tests. |

Optional follow-up (not in scope for initial release): extract `ReasoningBlock` / `TraceActivityCard` into `webui/src/components/thread/activity/` if `AgentActivityCluster.tsx` grows too large.

## Test Coverage

| File | Changes |
|------|---------|
| `webui/src/tests/agent-activity-cluster.test.tsx` | Rewritten per below |
| `webui/src/tests/tool-call-detail.test.tsx` | None |
| `webui/src/tests/thread-messages.test.tsx` | None |

New cases in `agent-activity-cluster.test.tsx`:

1. `groupActivityMessages` alternation: given `[r1, r2, t1, r3]`, produces `[{reasoning:[r1,r2]}, {trace:t1}, {reasoning:[r3]}]`
2. Interspersed reasoning stays separate: given `[r1, t1, r2, t2, r3]`, produces 5 groups (no merging across tools)
3. Per-block auto-open: only the last `ReasoningBlock` is expanded while `isTurnStreaming=true`
4. Per-block hold-open: after `isTurnStreaming` flips to false, the last block stays expanded 900ms then collapses
5. Past blocks don't auto-collapse: a block the user opened stays open when new items arrive
6. User toggle overrides auto: clicking a past block toggles only that block
7. Trace cards always visible: rendered without needing to expand any cluster
8. File-only activity: still renders `FileEditFlatActivity` (regression guard)
9. Mixed turn with file edits: trace cards render in order, then a trailing `FileEditGroup` renders below

## Verification

1. `cd webui && bun run build` — zero type errors
2. `cd webui && bun run test` — all tests pass
3. Manual:
   - Reasoning-only turn → single Thought block (expanded while streaming, collapses after)
   - Tools-only turn → inline trace cards, no Thought block
   - Mixed turn → real-time interleaving in chat scroll
   - Click a Thought header → toggles only that block, others unaffected
   - Click "Show details" on a trace card row → expands input/output params
   - File-only turn → still renders `FileEditFlatActivity` compact view
   - Mixed turn with file edits → trace cards interleave with reasoning, `FileEditGroup` renders at the bottom
   - Streaming: chat-level auto-scroll continues to work (cluster no longer owns a scrollport)

## Out of Scope

- No changes to backend / SSE event format
- No changes to how reasoning messages are emitted or grouped upstream
- No changes to file-edit-only flat layout
- No extraction of new sub-components into separate files (deferred)
- No per-item avatar / timestamp rendering (still one avatar per activity unit, via `ThreadMessages`)
