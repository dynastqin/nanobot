# Inline Tool Activity v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Agents will flip `- [ ]` to `- [x]` as they complete steps.

**Goal:** Refactor `AgentActivityCluster` so Thinking content and tool/shell calls interleave in real-time in the chat scroll — each reasoning chunk in its own collapsible, each tool call always visible with expandable input/output.

**Architecture:** Approach A from `docs/plan/2026-07-09-inline-tool-activity.md`. Keep the data layer (`normalizeActivityTimeline`) and `ThreadMessages` unchanged. Inside `AgentActivityCluster.tsx`, drop the outer "Thought for Xs" fold and shared scrollport. Group consecutive reasoning messages, render each group as a `ReasoningBlock` (own collapsible) and each trace message as a `TraceActivityCard` (always visible). Preserve `FileEditFlatActivity` for file-only turns; keep trailing `FileEditGroup` for mixed turns with file edits.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, React Testing Library, i18next.

**Spec:** `docs/plan/2026-07-09-inline-tool-activity.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `webui/src/components/thread/AgentActivityCluster.tsx` | Single-file refactor. Adds `groupActivityMessages`, `ReasoningBlock`, `TraceActivityCard`. Removes outer fold UI, scrollport logic, aggregate labels, `ActivityTraceTimeline`. Preserves `FileEditFlatActivity`, `FileEditGroup`, all trace row / CLI / MCP primitives, and all existing helpers (`traceLines`, `cliRunMapByTraceLine`, `mcpRunMapByTraceLine`, `toolEvidenceByTraceLine`, `countActivity`, `summarizeFileEdits`, etc.). |
| `webui/src/tests/agent-activity-cluster.test.tsx` | Rewritten. Adds unit tests for `groupActivityMessages`, `ReasoningBlock`, `TraceActivityCard`. Removes obsolete scrollport + cluster-header tests. Adds integration tests for alternation + per-block state. Preserves file-edit / CLI / MCP tests. |

Components stay in `AgentActivityCluster.tsx` for the initial release. Extraction into `webui/src/components/thread/activity/{ReasoningBlock,TraceActivityCard}.tsx` is a follow-up, out of scope.

---

## Tasks

### Task 1: Add `groupActivityMessages` helper

Pure function that walks a flat list of activity messages and produces alternating `{kind:"reasoning"|"trace"}` groups. Consecutive reasoning-only messages merge into one group; every trace message is its own group.

**Files:**
- Modify: `webui/src/components/thread/AgentActivityCluster.tsx`
- Test: `webui/src/tests/agent-activity-cluster.test.tsx`

- [x] **Step 1: Write the failing tests**

Add to `webui/src/tests/agent-activity-cluster.test.tsx` (top-level, outside the existing `describe` block — add a new `describe` for the helper):

```tsx
import { groupActivityMessages } from "@/components/thread/AgentActivityCluster";

describe("groupActivityMessages", () => {
  it("merges consecutive reasoning messages into one group", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "a", createdAt: 1 },
      { id: "r2", role: "assistant", content: "", reasoning: "b", createdAt: 2 },
      { id: "r3", role: "assistant", content: "", reasoning: "c", createdAt: 3 },
    ];
    const groups = groupActivityMessages(messages);
    expect(groups).toEqual([{ kind: "reasoning", messages }]);
  });

  it("splits reasoning groups when a trace is between them", () => {
    const r1: UIMessage = { id: "r1", role: "assistant", content: "", reasoning: "a", createdAt: 1 };
    const t1: UIMessage = { id: "t1", role: "tool", kind: "trace", content: "search()", traces: ["search()"], createdAt: 2 };
    const r2: UIMessage = { id: "r2", role: "assistant", content: "", reasoning: "b", createdAt: 3 };
    const groups = groupActivityMessages([r1, t1, r2]);
    expect(groups).toEqual([
      { kind: "reasoning", messages: [r1] },
      { kind: "trace", message: t1 },
      { kind: "reasoning", messages: [r2] },
    ]);
  });

  it("produces alternating groups for interspersed reasoning and traces", () => {
    const r1: UIMessage = { id: "r1", role: "assistant", content: "", reasoning: "a", createdAt: 1 };
    const t1: UIMessage = { id: "t1", role: "tool", kind: "trace", content: "x()", traces: ["x()"], createdAt: 2 };
    const r2: UIMessage = { id: "r2", role: "assistant", content: "", reasoning: "b", createdAt: 3 };
    const t2: UIMessage = { id: "t2", role: "tool", kind: "trace", content: "y()", traces: ["y()"], createdAt: 4 };
    const r3: UIMessage = { id: "r3", role: "assistant", content: "", reasoning: "c", createdAt: 5 };
    const groups = groupActivityMessages([r1, t1, r2, t2, r3]);
    expect(groups).toHaveLength(5);
    expect(groups.map((g) => g.kind)).toEqual(["reasoning", "trace", "reasoning", "trace", "reasoning"]);
  });

  it("returns an empty array for no messages", () => {
    expect(groupActivityMessages([])).toEqual([]);
  });

  it("ignores non-activity messages", () => {
    const r1: UIMessage = { id: "r1", role: "assistant", content: "answer", createdAt: 1 };
    const t1: UIMessage = { id: "t1", role: "tool", kind: "trace", content: "x()", traces: ["x()"], createdAt: 2 };
    const groups = groupActivityMessages([r1, t1]);
    expect(groups).toEqual([{ kind: "trace", message: t1 }]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx -t "groupActivityMessages"
```

Expected: FAIL with import error or "groupActivityMessages is not exported".

- [x] **Step 3: Implement `groupActivityMessages`**

In `webui/src/components/thread/AgentActivityCluster.tsx`, add the type and function near the other helpers (e.g., just below the `isAgentActivityMember` re-export on line 42):

```ts
export type ActivityGroup =
  | { kind: "reasoning"; messages: UIMessage[] }
  | { kind: "trace"; message: UIMessage };

/**
 * Walk a flat list of activity messages and produce alternating reasoning/trace groups.
 * Consecutive reasoning-only messages merge into one group; every trace message is its own group.
 * Non-activity messages are dropped (caller filters them out upstream).
 */
export function groupActivityMessages(messages: UIMessage[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let reasoningBuffer: UIMessage[] = [];

  const flushReasoning = () => {
    if (reasoningBuffer.length === 0) return;
    groups.push({ kind: "reasoning", messages: reasoningBuffer });
    reasoningBuffer = [];
  };

  for (const message of messages) {
    if (isReasoningOnlyAssistant(message)) {
      reasoningBuffer.push(message);
      continue;
    }
    if (message.kind === "trace") {
      flushReasoning();
      groups.push({ kind: "trace", message });
      continue;
    }
    // Non-activity messages are ignored.
  }
  flushReasoning();
  return groups;
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx -t "groupActivityMessages"
```

Expected: PASS (all 5 cases).

---

### Task 2: Add `ReasoningBlock` component

A collapsible card for one or more consecutive reasoning messages. Manages its own expand/collapse state with auto-open-while-streaming and a 900ms hold-open on completion.

**Files:**
- Modify: `webui/src/components/thread/AgentActivityCluster.tsx`
- Test: `webui/src/tests/agent-activity-cluster.test.tsx`

- [x] **Step 1: Write the failing tests**

Add a new `describe` block to `webui/src/tests/agent-activity-cluster.test.tsx`:

```tsx
import { ReasoningBlock } from "@/components/thread/AgentActivityCluster";

describe("ReasoningBlock", () => {
  it("expands while streaming and is the last block", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "thinking...", reasoningStreaming: true, isStreaming: true, createdAt: 1 },
    ];
    render(
      <ReasoningBlock
        messages={messages}
        streaming
        isLast
        hasBodyBelow={false}
      />,
    );
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    // Expanded means body content is shown
    expect(screen.getByText("thinking...")).toBeInTheDocument();
  });

  it("auto-collapses when streaming ends and isLast becomes false", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "secret thought", createdAt: 1 },
    ];
    const { rerender } = render(
      <ReasoningBlock messages={messages} streaming isLast hasBodyBelow={false} />,
    );
    expect(screen.getByText("secret thought")).toBeInTheDocument();

    rerender(
      <ReasoningBlock messages={messages} streaming={false} isLast={false} hasBodyBelow={false} />,
    );
    expect(screen.queryByText("secret thought")).not.toBeInTheDocument();
  });

  it("hold-opens for 900ms when streaming ends on the last block", () => {
    vi.useFakeTimers();
    try {
      const messages: UIMessage[] = [
        { id: "r1", role: "assistant", content: "", reasoning: "final thought", reasoningStreaming: true, isStreaming: true, createdAt: 1 },
      ];
      const { rerender } = render(
        <ReasoningBlock messages={messages} streaming isLast hasBodyBelow={false} />,
      );
      expect(screen.getByText("final thought")).toBeInTheDocument();

      rerender(
        <ReasoningBlock messages={messages} streaming={false} isLast hasBodyBelow={false} />,
      );
      // Still open during hold
      expect(screen.getByText("final thought")).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(901); });
      expect(screen.queryByText("final thought")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("user click toggles open state and overrides auto", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "past thought", createdAt: 1 },
    ];
    render(
      <ReasoningBlock messages={messages} streaming={false} isLast={false} hasBodyBelow={false} />,
    );
    // Initially collapsed (not streaming, not last)
    expect(screen.queryByText("past thought")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /thought/i }));
    expect(screen.getByText("past thought")).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(screen.getByRole("button", { name: /thought/i }));
    expect(screen.queryByText("past thought")).not.toBeInTheDocument();
  });

  it("shows duration label when messages have valid timestamps", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "a", createdAt: 1_000 },
      { id: "r2", role: "assistant", content: "", reasoning: "b", createdAt: 5_000 },
    ];
    render(
      <ReasoningBlock messages={messages} streaming={false} isLast hasBodyBelow={false} />,
    );
    // 4s duration between createdAt 1000 and 5000
    expect(screen.getByText(/thought for 4s/i)).toBeInTheDocument();
  });

  it("shows plain 'Thought' when duration rounds to zero", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "instant", createdAt: 1_000 },
    ];
    render(
      <ReasoningBlock messages={messages} streaming={false} isLast hasBodyBelow={false} />,
    );
    expect(screen.getByText(/^thought$/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx -t "ReasoningBlock"
```

Expected: FAIL with import error.

- [x] **Step 3: Implement `ReasoningBlock`**

In `webui/src/components/thread/AgentActivityCluster.tsx`, add the import for `MarkdownText` near the top (next to the existing imports — check if `ReasoningRow.tsx` imports it and mirror):

```ts
import { MarkdownText, preloadMarkdownText } from "@/components/MarkdownText";
```

Then add the component (e.g., just below `groupActivityMessages`):

```tsx
export interface ReasoningBlockProps {
  messages: UIMessage[];
  streaming: boolean;
  isLast: boolean;
  hasBodyBelow: boolean;
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}

export function ReasoningBlock({
  messages,
  streaming,
  isLast,
  hasBodyBelow,
  onOpenFilePreview,
  onOpenLink,
}: ReasoningBlockProps) {
  const { t } = useTranslation();
  const [userToggled, setUserToggled] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prevStreamingRef = useRef(streaming);

  // Live "now" tick while streaming (for the duration label)
  useEffect(() => {
    if (!streaming) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [streaming]);

  // Hold-open for 900ms when streaming flips to false
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming) {
      setHoldOpen(true);
      const timeout = window.setTimeout(() => setHoldOpen(false), 900);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [streaming]);

  const autoOpen = (streaming || holdOpen) && isLast;
  const open = userToggled ? localOpen : autoOpen;

  // Duration from the group's own messages
  const timestamps = messages
    .map((m) => m.createdAt)
    .filter((value) => Number.isFinite(value));
  const hasTimestamps = timestamps.length > 0;
  const first = hasTimestamps ? Math.min(...timestamps) : 0;
  const last = streaming && first > 1_000_000_000_000
    ? now
    : hasTimestamps ? Math.max(...timestamps) : 0;
  const durationMs = hasTimestamps ? Math.max(0, last - first) : 0;
  const duration = formatActivityDuration(durationMs);

  const label = streaming
    ? durationMs <= 0
      ? t("message.activityThinking", { defaultValue: "Thinking…" })
      : t("message.activityThinkingFor", { duration, defaultValue: "Thinking for {{duration}}" })
    : durationMs <= 0
      ? t("message.activityThought", { defaultValue: "Thought" })
      : t("message.activityThoughtFor", { duration, defaultValue: "Thought for {{duration}}" });

  const handleClick = () => {
    setUserToggled(true);
    setLocalOpen(!open);
  };

  useEffect(() => {
    if (messages.some((m) => (m.reasoning ?? "").length > 0)) preloadMarkdownText();
  }, [messages]);

  return (
    <div className={cn("w-full", hasBodyBelow && "mb-2")}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "group flex max-w-full items-center gap-1.5 rounded-md px-1 py-1",
          "text-[12.5px] text-muted-foreground/72 transition-colors hover:text-muted-foreground",
        )}
        aria-expanded={open}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <StreamingLabelSheen active={streaming} className="min-w-0">
          {label}
        </StreamingLabelSheen>
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="ml-1 mt-1 space-y-1 pl-1">
          {messages.map((m) => {
            const text = m.reasoning ?? "";
            if (!text.trim()) return null;
            return (
              <MarkdownText
                key={m.id}
                streaming={streaming && !!m.reasoningStreaming}
                onOpenFilePreview={onOpenFilePreview}
                onOpenLink={onOpenLink}
                className={cn(
                  "min-w-0 text-[12.5px] italic text-muted-foreground/78",
                  "prose-p:my-1 prose-li:my-0.5",
                  "prose-headings:mt-2 prose-headings:mb-1 prose-headings:font-medium",
                  "prose-headings:text-muted-foreground/88 prose-strong:text-muted-foreground",
                  "prose-h1:text-[15px] prose-h2:text-[13.5px] prose-h3:text-[12.5px] prose-h4:text-[12px]",
                  "prose-a:text-blue-500 prose-a:underline hover:prose-a:text-blue-600 dark:prose-a:text-blue-300 dark:hover:prose-a:text-blue-200",
                  "prose-code:text-[0.92em]",
                )}
              >
                {text}
              </MarkdownText>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx -t "ReasoningBlock"
```

Expected: PASS (all 6 cases).

---

### Task 3: Add `TraceActivityCard` component

An always-visible card for one trace message. Renders tool rows, CLI runs, MCP runs, and media evidence — same body as `ActivityTraceTimeline` but without the `ActivityGroup` wrapper. Each row includes `ToolCallDetail` for expandable input/output params.

**Files:**
- Modify: `webui/src/components/thread/AgentActivityCluster.tsx`
- Test: `webui/src/tests/agent-activity-cluster.test.tsx`

- [x] **Step 1: Write the failing tests**

Add a new `describe` block:

```tsx
import { TraceActivityCard } from "@/components/thread/AgentActivityCluster";

describe("TraceActivityCard", () => {
  it("renders a tool call row with expandable details", () => {
    const message: UIMessage = {
      id: "t1",
      role: "tool",
      kind: "trace",
      content: 'search({"query":"x"})',
      traces: ['search({"query":"x"})'],
      toolEvents: [{
        phase: "end",
        call_id: "call-search",
        name: "search",
        arguments: { query: "x" },
        result: { hits: 3 },
      }],
      createdAt: 1,
    };
    render(
      <TraceActivityCard
        message={message}
        active={false}
        cliAppsByName={new Map()}
        mcpPresetsByName={new Map()}
      />,
    );
    // Tool call row visible
    expect(screen.getByText("Searching")).toBeInTheDocument();
    // ToolCallDetail toggle visible
    expect(screen.getByRole("button", { name: /show details/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("renders CLI app runs with brand logo", () => {
    const line = 'run_cli_app({"name":"blender","args":["--background","scene.blend"],"json":true})';
    const message: UIMessage = {
      id: "t-cli",
      role: "tool",
      kind: "trace",
      content: line,
      traces: [line],
      createdAt: 1,
    };
    render(
      <TraceActivityCard
        message={message}
        active
        cliAppsByName={new Map([["blender", BLENDER_CLI_APP]])}
        mcpPresetsByName={new Map()}
      />,
    );
    expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("@blender");
    expect(screen.getByTestId("activity-cli-logo-blender")).toBeInTheDocument();
  });

  it("renders MCP preset runs with brand logo", () => {
    const line = 'mcp_browserbase_navigate({"url":"https://example.com"})';
    const message: UIMessage = {
      id: "t-mcp",
      role: "tool",
      kind: "trace",
      content: line,
      traces: [line],
      toolEvents: [{
        phase: "end",
        call_id: "call-mcp",
        name: "mcp_browserbase_navigate",
        arguments: { url: "https://example.com" },
      }],
      createdAt: 1,
    };
    render(
      <TraceActivityCard
        message={message}
        active={false}
        cliAppsByName={new Map()}
        mcpPresetsByName={new Map([["browserbase", BROWSERBASE_MCP]])}
      />,
    );
    expect(screen.getByTestId("activity-mcp-runs")).toHaveTextContent("Browserbase");
  });

  it("returns null for an empty trace message", () => {
    const message: UIMessage = {
      id: "t-empty",
      role: "tool",
      kind: "trace",
      content: "",
      traces: [],
      createdAt: 1,
    };
    const { container } = render(
      <TraceActivityCard
        message={message}
        active={false}
        cliAppsByName={new Map()}
        mcpPresetsByName={new Map()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx -t "TraceActivityCard"
```

Expected: FAIL with import error.

- [x] **Step 3: Implement `TraceActivityCard`**

In `webui/src/components/thread/AgentActivityCluster.tsx`, add the component near `ReasoningBlock`. The body is extracted from the existing `ActivityTraceTimeline` (lines ~662-803) but returns a `Fragment` instead of an `ActivityGroup`:

```tsx
export interface TraceActivityCardProps {
  message: UIMessage;
  active: boolean;
  cliAppsByName: Map<string, CliAppInfo>;
  mcpPresetsByName: Map<string, McpPresetInfo>;
}

export function TraceActivityCard({
  message,
  active,
  cliAppsByName,
  mcpPresetsByName,
}: TraceActivityCardProps) {
  const lines = traceLines(message);
  const cliRunsByLine = cliRunMapByTraceLine(message);
  const mcpRunsByLine = mcpRunMapByTraceLine(message);
  const evidenceByLine = toolEvidenceByTraceLine(message);
  const trailingEvidence = activityEvidenceFromMessageMedia(message);
  const renderedRunKeys = new Set<string>();
  const items: ReactNode[] = [];
  let normalLines: string[] = [];

  const eventByLine = useMemo(() => {
    const map = new Map<string, ToolProgressEvent>();
    for (const event of message.toolEvents ?? []) {
      const traceLine = formatToolCallTrace(event);
      if (traceLine) map.set(traceLine, event);
    }
    return map;
  }, [message.toolEvents]);

  const flushNormalLines = (suffix: string) => {
    if (!normalLines.length) return;
    items.push(
      <ul key={`${message.id}:trace:${suffix}`} className="space-y-1">
        {normalLines.map((line, index) => (
          <ActivityTraceRow
            key={`${line}-${suffix}-${index}`}
            line={line}
            active={active && index === normalLines.length - 1}
            evidence={evidenceByLine?.get(line) ?? []}
            toolEvent={eventByLine.get(line)}
          />
        ))}
      </ul>,
    );
    normalLines = [];
  };

  lines.forEach((line, index) => {
    const cliRun = cliRunsByLine.get(line) ?? parseCliRunTrace(line);
    if (cliRun) {
      flushNormalLines(String(index));
      renderedRunKeys.add(cliRun.key);
      items.push(
        <CliRunGroup
          key={`${message.id}:cli:${cliRun.key}:${index}`}
          runs={[cliRun]}
          active={active}
          cliAppsByName={cliAppsByName}
        />,
      );
      const evidence = evidenceByLine.get(line) ?? [];
      if (evidence.length) {
        items.push(
          <ActivityEvidenceList
            key={`${message.id}:cli-evidence:${cliRun.key}:${index}`}
            evidence={evidence}
          />,
        );
      }
      return;
    }

    const mcpRun = mcpRunsByLine.get(line) ?? parseMcpRunTrace(line);
    if (mcpRun) {
      flushNormalLines(String(index));
      renderedRunKeys.add(mcpRun.key);
      items.push(
        <McpRunGroup
          key={`${message.id}:mcp:${mcpRun.key}:${index}`}
          runs={[mcpRun]}
          active={active}
          mcpPresetsByName={mcpPresetsByName}
        />,
      );
      const evidence = evidenceByLine.get(line) ?? [];
      if (evidence.length) {
        items.push(
          <ActivityEvidenceList
            key={`${message.id}:mcp-evidence:${mcpRun.key}:${index}`}
            evidence={evidence}
          />,
        );
      }
      return;
    }

    normalLines.push(line);
  });

  flushNormalLines("tail");

  for (const run of cliRunsByLine.values()) {
    if (renderedRunKeys.has(run.key)) continue;
    items.push(
      <CliRunGroup
        key={`${message.id}:cli:${run.key}:event`}
        runs={[run]}
        active={active}
        cliAppsByName={cliAppsByName}
      />,
    );
  }
  for (const run of mcpRunsByLine.values()) {
    if (renderedRunKeys.has(run.key)) continue;
    items.push(
      <McpRunGroup
        key={`${message.id}:mcp:${run.key}:event`}
        runs={[run]}
        active={active}
        mcpPresetsByName={mcpPresetsByName}
      />,
    );
  }

  if (trailingEvidence.length) {
    items.push(
      <ActivityEvidenceList
        key={`${message.id}:media-evidence`}
        evidence={trailingEvidence}
      />,
    );
  }

  if (!items.length) return null;
  return <div className="w-full">{items}</div>;
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx -t "TraceActivityCard"
```

Expected: PASS (all 4 cases).

---

### Task 4: Rewrite `AgentActivityCluster` main render + remove dead code + update tests

This is the core refactor: drop the outer fold + scrollport, use `groupActivityMessages` to split messages, render alternating `ReasoningBlock` + `TraceActivityCard`, preserve file-only path and trailing `FileEditGroup`. Also remove all dead code (the project's `tsconfig.json` has `noUnusedLocals: true`, so unused module-level helpers will fail the build) and update the test file.

**Why this is one task, not three:** the rewrite, dead-code removal, and test updates all need to land together to keep the build green. Splitting them would leave TypeScript errors or failing tests between tasks.

**Files:**
- Modify: `webui/src/components/thread/AgentActivityCluster.tsx`
- Modify: `webui/src/tests/agent-activity-cluster.test.tsx`

- [x] **Step 1: Replace the `AgentActivityCluster` function body**

In `webui/src/components/thread/AgentActivityCluster.tsx`, find the current `AgentActivityCluster` function (starts around line 185 with `export function AgentActivityCluster({`). Replace its ENTIRE body — all the existing locals, state, effects, derived values, and the return statement — with this:

```tsx
export function AgentActivityCluster({
  messages,
  isTurnStreaming,
  hasBodyBelow,
  turnLatencyMs,
  cliApps = [],
  mcpPresets = [],
  onOpenFilePreview,
  onOpenLink,
}: AgentActivityClusterProps) {
  const fileEdits = useMemo(
    () => summarizeFileEdits(collectFileEdits(messages), isTurnStreaming),
    [messages, isTurnStreaming],
  );
  const cliAppsByName = useMemo(
    () => new Map(cliApps.map((app) => [app.name.toLowerCase(), app])),
    [cliApps],
  );
  const mcpPresetsByName = useMemo(
    () => new Map(mcpPresets.map((preset) => [preset.name.toLowerCase(), preset])),
    [mcpPresets],
  );

  const counts = countActivity(messages, fileEdits, collectCliRuns(messages), collectMcpRuns(messages));
  const hasVisibleActivity =
    counts.reasoningSteps > 0
    || counts.toolCalls > 0
    || counts.cliCount > 0
    || counts.mcpCount > 0
    || counts.fileCount > 0;
  const hasOnlyFileActivity = fileEdits.length > 0 && messages.every(messageHasOnlyFileActivity);

  // `turnLatencyMs` is accepted for API compatibility but no longer used to compute
  // an aggregate duration (per-block durations come from message timestamps).
  void turnLatencyMs;

  if (!hasVisibleActivity) return null;

  if (hasOnlyFileActivity) {
    const singleFilePath = counts.fileCount === 1 ? counts.primaryFilePath : undefined;
    const singleFileTooltipPath = counts.fileCount === 1 ? counts.primaryFileTooltipPath : undefined;
    const hasLiveEditingFiles = isTurnStreaming && counts.hasEditingFiles;
    return (
      <FileEditFlatActivity
        edits={fileEdits}
        active={isTurnStreaming}
        hasBodyBelow={hasBodyBelow}
        summary={fileOnlySummary(counts, isTurnStreaming)}
        singleFilePath={singleFilePath}
        singleFileTooltipPath={singleFileTooltipPath}
        hasLiveEditingFiles={hasLiveEditingFiles}
        hasFailedFiles={counts.hasFailedFiles}
        hasDeletedFiles={counts.hasDeletedFiles}
        added={counts.added}
        deleted={counts.deleted}
        hasDiffStats={counts.hasDiffStats}
        onOpenFilePreview={onOpenFilePreview}
      />
    );
  }

  const groups = useMemo(() => groupActivityMessages(messages), [messages]);

  return (
    <div className={cn("flex w-full flex-col gap-1", hasBodyBelow && "mb-2")}>
      {groups.map((group, index) => {
        const isLast = index === groups.length - 1;
        if (group.kind === "reasoning") {
          const streaming = isTurnStreaming
            && isLast
            && group.messages.some((m) => m.reasoningStreaming || m.isStreaming);
          return (
            <ReasoningBlock
              key={`reasoning:${group.messages[0]?.id ?? index}`}
              messages={group.messages}
              streaming={streaming}
              isLast={isLast}
              hasBodyBelow={hasBodyBelow && isLast}
              onOpenFilePreview={onOpenFilePreview}
              onOpenLink={onOpenLink}
            />
          );
        }
        return (
          <TraceActivityCard
            key={`trace:${group.message.id}`}
            message={group.message}
            active={isTurnStreaming && isLast}
            cliAppsByName={cliAppsByName}
            mcpPresetsByName={mcpPresetsByName}
          />
        );
      })}
      {fileEdits.length ? (
        <FileEditGroup edits={fileEdits} onOpenFilePreview={onOpenFilePreview} />
      ) : null}
    </div>
  );
}

function fileOnlySummary(counts: ActivityCounts, active: boolean): string {
  const fileCount = counts.fileCount;
  const hasLiveEditingFiles = active && counts.hasEditingFiles;
  const verb = fileActivityVerb(hasLiveEditingFiles, counts.hasFailedFiles, counts.hasDeletedFiles);
  if (fileCount === 1 && counts.primaryFilePath) {
    return `${verb} ${shortFileName(counts.primaryFilePath)}`;
  }
  return `${verb} ${fileCount} files`;
}
```

Keep the existing `interface AgentActivityClusterProps` (unchanged) and all helpers above and below the function.

- [x] **Step 2: Remove now-dead module-level code**

Because `noUnusedLocals: true` is on, these must be deleted together with Step 1 (in the same edit session). Delete each of these from `webui/src/components/thread/AgentActivityCluster.tsx`:

**Functions:**
- `ActivityTraceTimeline` (replaced by `TraceActivityCard`)
- `describeActivityGroup` (only called by `ActivityTraceTimeline`)
- `allToolEvidence` (only called by `describeActivityGroup`)
- `activityDurationMs` (was used by the old aggregate duration; per-block uses inline calc in `ReasoningBlock`)

**Constants:**
- `CLUSTER_SCROLL_MAX_CLASS` (was the `max-h-52` scrollport class)
- `ACTIVITY_SCROLL_NEAR_BOTTOM_PX` (was the near-bottom threshold for the scrollport)

**Sanity check:** after deletion, search the file for each name to confirm zero remaining references:
```bash
cd webui && grep -n "ActivityTraceTimeline\|describeActivityGroup\|allToolEvidence\|activityDurationMs\|CLUSTER_SCROLL_MAX_CLASS\|ACTIVITY_SCROLL_NEAR_BOTTOM_PX" src/components/thread/AgentActivityCluster.tsx
```
Expected: no matches.

- [x] **Step 3: Trim unused imports**

After Steps 1-2, some imports may no longer be used. Run the build (Step 5) to surface them; then delete the unused ones from the import block at the top of the file. Likely candidates:
- `useLayoutEffect` (was used by scroll-follow effect — check if still used elsewhere in the file; if not, remove)
- `ActivityGroup` (was used by `ActivityTraceTimeline`'s return — check if `FileEditFlatActivity` or other code still uses it; if not, remove)

Do NOT remove these without checking — some may still be referenced by preserved code.

- [x] **Step 4: Update the test file**

In `webui/src/tests/agent-activity-cluster.test.tsx`:

**Delete** these tests inside `describe("AgentActivityCluster", ...)` (they test the removed outer fold / scrollport and no longer apply):
- `"jumps to the latest activity when opened"` — scrollport-based
- `"follows new reasoning and tool activity while the user is at the bottom"` — scrollport-based
- `"does not pull the user down after they scroll up inside the activity pane"` — scrollport-based
- `"briefly shows completed activity, then auto-collapses before the answer"` — now per-block (covered by `ReasoningBlock`'s "hold-opens" test in Task 2)
- `"uses persisted turn latency for completed history instead of replay timestamps"` — aggregate label gone
- `"labels mixed tool activity as work instead of thought"` — aggregate label gone
- `"omits the duration when completed history has no reliable timing"` — covered by `ReasoningBlock`'s "shows plain 'Thought' when duration rounds to zero" test in Task 2
- `"turns the live reasoning marker into an animated check when thinking completes"` — references `activity-reasoning-marker` testid, which was rendered by `ReasoningRow`. The new `ReasoningBlock` renders `MarkdownText` directly (no per-row marker). Delete (the marker transition is now a `ReasoningRow` internal concern, not surfaced in the new cluster).

**Delete** these helper functions (no longer used after the scrollport tests are gone):
- `installAnimationFrameQueue`
- `setScrollGeometry`

**Add** these new integration tests inside `describe("AgentActivityCluster", ...)`:

```tsx
it("renders interleaved reasoning blocks and trace cards in order", () => {
  const r1: UIMessage = { id: "r1", role: "assistant", content: "", reasoning: "first", createdAt: 1 };
  const t1: UIMessage = { id: "t1", role: "tool", kind: "trace", content: "search()", traces: ["search()"], createdAt: 2 };
  const r2: UIMessage = { id: "r2", role: "assistant", content: "", reasoning: "second", createdAt: 3 };
  const t2: UIMessage = { id: "t2", role: "tool", kind: "trace", content: "edit()", traces: ["edit()"], createdAt: 4 };
  render(
    <AgentActivityCluster
      messages={[r1, t1, r2, t2]}
      isTurnStreaming={false}
      hasBodyBelow={false}
    />,
  );
  // Both reasoning blocks render their label
  const thoughtLabels = screen.getAllByText(/^thought$/i);
  expect(thoughtLabels.length).toBeGreaterThanOrEqual(2);
  // Both trace cards render their tool row
  expect(screen.getByText("Searching")).toBeInTheDocument();
});

it("renders a single Thought block when only reasoning is present", () => {
  render(
    <AgentActivityCluster
      messages={[
        { id: "r1", role: "assistant", content: "", reasoning: "alone", createdAt: 1 },
      ]}
      isTurnStreaming={false}
      hasBodyBelow
    />,
  );
  expect(screen.getAllByText(/^thought$/i).length).toBe(1);
});

it("renders trace cards without any Thought block when only tools are present", () => {
  render(
    <AgentActivityCluster
      messages={[
        { id: "t1", role: "tool", kind: "trace", content: "search()", traces: ["search()"], createdAt: 1 },
      ]}
      isTurnStreaming={false}
      hasBodyBelow
    />,
  );
  expect(screen.queryByText(/^thought$/i)).not.toBeInTheDocument();
  expect(screen.getByText("Searching")).toBeInTheDocument();
});

it("auto-expands only the last reasoning block while streaming", () => {
  const r1: UIMessage = { id: "r1", role: "assistant", content: "", reasoning: "past", createdAt: 1 };
  const t1: UIMessage = { id: "t1", role: "tool", kind: "trace", content: "search()", traces: ["search()"], createdAt: 2 };
  const r2: UIMessage = { id: "r2", role: "assistant", content: "", reasoning: "live", reasoningStreaming: true, isStreaming: true, createdAt: 3 };
  render(
    <AgentActivityCluster
      messages={[r1, t1, r2]}
      isTurnStreaming
      hasBodyBelow
    />,
  );
  expect(screen.getByText("live")).toBeInTheDocument();
  expect(screen.queryByText("past")).not.toBeInTheDocument();
});

it("renders trailing FileEditGroup after trace cards in a mixed turn", () => {
  render(
    <AgentActivityCluster
      messages={[
        { id: "r1", role: "assistant", content: "", reasoning: "thinking", createdAt: 1 },
        {
          id: "t1", role: "tool", kind: "trace",
          content: "edit_file()",
          traces: ["edit_file()"],
          fileEdits: [{
            call_id: "call-edit",
            tool: "edit_file",
            path: "src/app.tsx",
            absolute_path: "/Users/x/project/src/app.tsx",
            phase: "end",
            added: 5, deleted: 1, approximate: false, status: "done",
          }],
          createdAt: 2,
        },
      ]}
      isTurnStreaming={false}
      hasBodyBelow={false}
    />,
  );
  expect(screen.getByText(/app\.tsx/i)).toBeInTheDocument();
  expect(screen.getByText("+5")).toBeInTheDocument();
});

it("renders nothing when given an empty message list", () => {
  const { container } = render(
    <AgentActivityCluster messages={[]} isTurnStreaming={false} hasBodyBelow={false} />,
  );
  expect(container.firstChild).toBeNull();
});
```

**Update preserved tests that depend on removed UI:**

Several existing tests click the old cluster header button to expand content, or reference testids that no longer exist. In the new design, trace cards are always visible (no click needed) and there's no aggregate header. For each such test, update it:

- `"renders file edit totals and a compact expanded file list"` — DELETE. It clicks the cluster header button (`/edited app\.tsx/i`) and references `activity-header-file-reference`. The trailing `FileEditGroup` now renders inline without a header button. Replace with a new test `"renders trailing file edit details in a mixed turn"` that directly asserts the file path, diff stats, and file reference chip (use `activity-file-reference` testid, not the removed `activity-header-file-reference`).

```tsx
it("renders trailing file edit details in a mixed turn", () => {
  render(
    <AgentActivityCluster
      messages={activityMessages("", {
        id: "t2",
        role: "tool",
        kind: "trace",
        content: "edit_file()",
        traces: ["edit_file()"],
        fileEdits: [{
          call_id: "call-edit",
          tool: "edit_file",
          path: "src/app.tsx",
          absolute_path: "/Users/x/project/src/app.tsx",
          phase: "end",
          added: 12, deleted: 3, approximate: false, status: "done",
        }],
        createdAt: 3,
      })}
      isTurnStreaming={false}
      hasBodyBelow={false}
    />,
  );
  // File reference chip visible without clicking
  const fileRef = screen.getByTestId("activity-file-reference");
  expect(fileRef).toHaveTextContent("src/app.tsx");
  expect(screen.getAllByText("+12").length).toBeGreaterThan(0);
  expect(screen.getAllByText("-3").length).toBeGreaterThan(0);
});
```

- `"labels rejected CLI app calls as failed instead of ran"` — REMOVE the `fireEvent.click(...)` line (the CLI row is now always visible; no click needed). Keep the assertions:
```tsx
it("labels rejected CLI app calls as failed instead of ran", () => {
  render(
    <AgentActivityCluster
      messages={[{
        id: "t-cli-fail",
        role: "tool",
        kind: "trace",
        content: 'run_cli_app({"name":"github","args":["repo","view"],"json":"true"})',
        traces: ['run_cli_app({"name":"github","args":["repo","view"],"json":"true"})'],
        toolEvents: [{
          phase: "error",
          call_id: "call-github",
          name: "run_cli_app",
          arguments: { name: "github", args: ["repo", "view"], json: "true" },
          error: "Error: CLI app 'github' not found",
        }],
        createdAt: 1,
      }]}
      isTurnStreaming={false}
      hasBodyBelow={false}
    />,
  );
  expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("Failed");
  expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("@github");
  expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("Error: CLI app 'github' not found");
});
```

- Any other test that calls `fireEvent.click(screen.getByRole("button", { name: /.../i }))` before asserting on tool/CLI/MCP/file content — remove the click line. The content is now always visible.

- `"renders file-only edits without a redundant disclosure"` — KEEP as-is. It tests `hasOnlyFileActivity` path, which still uses `FileEditFlatActivity`. The assertions (`screen.queryByTestId("agent-activity-scroll")`, `screen.getByText("Edited")`, `activity-header-file-reference`) — wait, `activity-header-file-reference` IS still rendered by `FileEditFlatActivity`. Let me re-check.

Looking at the current `FileEditFlatActivity` (lines 555-623): it renders `<FileReferenceChip testId="activity-header-file-reference" ...>` when `singleFilePath` is set. So this testid IS still present in the file-only path. The test should pass unchanged. GOOD — keep it.

**Verify** by running tests after each batch of edits. If a test fails because it can't find an element that no longer exists, decide: delete the test (if it covered removed behavior) or update it (if it covered preserved behavior but via removed UI).

- [x] **Step 5: Run the type check**

```bash
cd webui && bun run build
```

Expected: zero type errors. If TypeScript complains about unused imports (e.g., `useLayoutEffect`, `ActivityGroup`), delete those imports and re-run.

- [x] **Step 6: Run the full test file**

```bash
cd webui && bun run test -- agent-activity-cluster.test.tsx
```

Expected: all remaining tests pass (preserved file-edit / CLI / MCP tests + new `groupActivityMessages` / `ReasoningBlock` / `TraceActivityCard` / integration tests).

---

### Task 5: Final verification

**Files:** none (verification only)

- [x] **Step 1: Full WebUI build**

```bash
cd webui && bun run build
```

Expected: success, zero type errors.

- [ ] **Step 2: Full WebUI test suite**

```bash
cd webui && bun run test
```

Expected: all tests pass.

> **Note:** 13 tests fail across `app-layout.test.tsx` (1), `i18n.test.tsx` (1), `thread-composer.test.tsx` (11). Verified pre-existing by running the same 3 files on commit `81983c58` (before this refactor) — identical 13 failures. None reference `AgentActivityCluster` / `ReasoningBlock` / `TraceActivityCard` / `groupActivityMessages`. The 59 tests touched by this refactor (39 in `agent-activity-cluster.test.tsx` + 20 in `thread-messages.test.tsx`) all pass.

- [ ] **Step 3: Manual verification**

Start the dev server and exercise each scenario. For each, confirm the chat-scroll layout matches the spec's mockup.

```bash
cd webui && bun run dev
```

Checklist:

- [ ] **Reasoning-only turn**: Single Thought block. Expanded while streaming, collapses ~900ms after streaming ends. Click header → toggles.
- [ ] **Tools-only turn**: Inline trace cards, no Thought block. Each card shows tool row + "Show details" toggle.
- [ ] **Mixed turn**: Real-time interleaving — Thought block → trace card → Thought block → trace card → … — in time order as the turn progresses.
- [ ] **Click a past Thought header**: Only that block toggles; others are unaffected.
- [ ] **Click "Show details" on a trace card row**: Expands to show Arguments / Result JSON blocks. Click again to collapse.
- [ ] **File-only turn**: Still renders the compact `FileEditFlatActivity` ("Edited app.tsx +12 -3").
- [ ] **Mixed turn with file edits**: Trace cards interleave with reasoning; `FileEditGroup` renders below all cards with diff stats.
- [ ] **CLI run**: `@blender` row with brand logo, args preview.
- [ ] **MCP run**: Branded MCP row with preset name + tool name.
- [ ] **Streaming scroll**: Chat-level auto-scroll continues to work (cluster no longer owns a scrollport). New items push the view down naturally.

---

## Self-Review Checklist (for plan author — already done)

- **Spec coverage:** Every section of `docs/plan/2026-07-09-inline-tool-activity.md` maps to a task. Approach A is implemented; Approach B is documented in the spec only (not implemented).
- **Placeholder scan:** No "TBD", "TODO", or vague steps. Every code step shows the actual code.
- **Type consistency:** `ActivityGroup`, `ReasoningBlockProps`, `TraceActivityCardProps` are defined once and referenced consistently. `groupActivityMessages` returns `ActivityGroup[]` and is consumed by the cluster's `groups.map`.
- **Test coverage:** Unit tests for `groupActivityMessages`, `ReasoningBlock`, `TraceActivityCard`. Integration tests for alternation, per-block state, file-only regression, mixed-turn-with-file-edits.

## Execution Handoff

Plan complete and saved to `docs/plan/2026-07-09-inline-tool-activity-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
