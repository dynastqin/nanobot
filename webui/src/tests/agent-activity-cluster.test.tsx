import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentActivityCluster, groupActivityMessages, groupActivityRounds, ReasoningBlock, TraceActivityCard } from "@/components/thread/AgentActivityCluster";
import type { CliAppInfo, McpPresetInfo, UIMessage } from "@/lib/types";

const BLENDER_CLI_APP: CliAppInfo = {
  name: "blender",
  display_name: "Blender",
  category: "3d",
  description: "3D creation",
  requires: "",
  source: "harness",
  entry_point: "cli-anything-blender",
  install_supported: true,
  installed: true,
  available: true,
  status: "installed",
  logo_url: "https://example.invalid/blender.svg",
  brand_color: "#E87D0D",
  skill_installed: true,
};

const BROWSERBASE_MCP: McpPresetInfo = {
  name: "browserbase",
  display_name: "Browserbase",
  category: "browser",
  description: "Cloud browser automation",
  docs_url: "https://docs.browserbase.com",
  transport: "streamableHttp",
  requires: "Browserbase API key",
  note: "",
  install_supported: true,
  installed: true,
  configured: true,
  available: true,
  status: "configured",
  logo_url: "https://example.invalid/browserbase.svg",
  brand_color: "#111827",
  required_fields: [],
  connection_summary: "https://mcp.browserbase.com/mcp",
};

function activityMessages(extraReasoning = "", extraTool?: UIMessage): UIMessage[] {
  const rows: UIMessage[] = [
    {
      id: "r1",
      role: "assistant",
      content: "",
      reasoning: `thinking${extraReasoning}`,
      reasoningStreaming: true,
      isStreaming: true,
      createdAt: 1,
    },
    {
      id: "t1",
      role: "tool",
      kind: "trace",
      content: "search()",
      traces: ["search()"],
      createdAt: 2,
    },
  ];
  if (extraTool) rows.push(extraTool);
  return rows;
}

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

describe("groupActivityRounds", () => {
  const r1: UIMessage = { id: "r1", role: "assistant", content: "", reasoning: "a", createdAt: 1 };
  const t1: UIMessage = { id: "t1", role: "tool", kind: "trace", content: "x()", traces: ["x()"], createdAt: 2 };
  const r2: UIMessage = { id: "r2", role: "assistant", content: "", reasoning: "b", createdAt: 3 };
  const t2: UIMessage = { id: "t2", role: "tool", kind: "trace", content: "y()", traces: ["y()"], createdAt: 4 };

  it("groups reasoning + traces into a round", () => {
    const groups = groupActivityMessages([r1, t1]);
    const rounds = groupActivityRounds(groups);
    expect(rounds).toEqual([
      { reasoning: { kind: "reasoning", messages: [r1] }, traces: [{ kind: "trace", message: t1 }] },
    ]);
  });

  it("splits at each reasoning block to start a new round", () => {
    const groups = groupActivityMessages([r1, t1, r2, t2]);
    const rounds = groupActivityRounds(groups);
    expect(rounds).toEqual([
      { reasoning: { kind: "reasoning", messages: [r1] }, traces: [{ kind: "trace", message: t1 }] },
      { reasoning: { kind: "reasoning", messages: [r2] }, traces: [{ kind: "trace", message: t2 }] },
    ]);
  });

  it("creates a round without reasoning when traces appear first", () => {
    const groups = groupActivityMessages([t1, r1]);
    const rounds = groupActivityRounds(groups);
    expect(rounds).toEqual([
      { traces: [{ kind: "trace", message: t1 }] },
      { reasoning: { kind: "reasoning", messages: [r1] }, traces: [] },
    ]);
  });

  it("handles reasoning-only (no traces)", () => {
    const groups = groupActivityMessages([r1]);
    const rounds = groupActivityRounds(groups);
    expect(rounds).toEqual([
      { reasoning: { kind: "reasoning", messages: [r1] }, traces: [] },
    ]);
  });

  it("handles trace-only (no reasoning)", () => {
    const groups = groupActivityMessages([t1, t2]);
    const rounds = groupActivityRounds(groups);
    expect(rounds).toEqual([
      { traces: [{ kind: "trace", message: t1 }, { kind: "trace", message: t2 }] },
    ]);
  });

  it("returns empty array for empty groups", () => {
    expect(groupActivityRounds([])).toEqual([]);
  });

  it("handles reasoning, trace, reasoning pattern", () => {
    const groups = groupActivityMessages([r1, t1, r2]);
    const rounds = groupActivityRounds(groups);
    expect(rounds).toEqual([
      { reasoning: { kind: "reasoning", messages: [r1] }, traces: [{ kind: "trace", message: t1 }] },
      { reasoning: { kind: "reasoning", messages: [r2] }, traces: [] },
    ]);
  });
});

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
    expect(screen.getAllByText(/thinking/i).length).toBeGreaterThan(0);
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

describe("AgentActivityCluster", () => {
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
    const thoughtLabels = screen.getAllByText(/^thought$/i);
    expect(thoughtLabels.length).toBe(2);
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
    const fileRef = screen.getByTestId("activity-file-reference");
    expect(fileRef).toHaveTextContent("src/app.tsx");
    expect(screen.getAllByText("+12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-3").length).toBeGreaterThan(0);
  });

  it("renders file-only edits without a redundant disclosure", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-file-only",
          role: "tool",
          kind: "trace",
          content: "apply_patch()",
          traces: ["apply_patch()"],
          fileEdits: [{
            call_id: "call-patch",
            tool: "apply_patch",
            path: "src/app.tsx",
            absolute_path: "/Users/renxubin/project/src/app.tsx",
            phase: "end",
            added: 12,
            deleted: 3,
            approximate: false,
            status: "done",
          }],
          createdAt: 3,
        }]}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /edited app\.tsx/i })).not.toBeInTheDocument();
    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.getByTestId("activity-header-file-reference")).toHaveTextContent("app.tsx");
    expect(screen.getByText("+12")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("shows 'Preparing edit…' for a pending file edit with no resolved path", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-pending",
          role: "tool",
          kind: "trace",
          content: "apply_patch()",
          traces: ["apply_patch()"],
          fileEdits: [{
            call_id: "call-pending",
            tool: "apply_patch",
            path: "",
            absolute_path: "",
            phase: "start",
            added: 0,
            deleted: 0,
            approximate: false,
            status: "editing",
          }],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );
    expect(screen.getByText("Preparing edit…")).toBeInTheDocument();
  });

  it("renders CLI app runs as dedicated activity rows", () => {
    const line = 'run_cli_app({"name":"blender","args":["--background","scene.blend"],"json":true})';
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-cli",
          role: "tool",
          kind: "trace",
          content: line,
          traces: [line],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
        cliApps={[BLENDER_CLI_APP]}
      />,
    );

    const cliRuns = screen.getByTestId("activity-cli-runs");
    expect(cliRuns).toHaveTextContent("Using");
    expect(cliRuns).toHaveTextContent("@blender");
    expect(cliRuns).toHaveTextContent("--json --background scene.blend");
    expect(screen.getByTestId("activity-cli-logo-blender")).toBeInTheDocument();
    expect(screen.queryByText(/run_cli_app/)).not.toBeInTheDocument();
  });

  it("keeps CLI rows in chronological trace order", () => {
    const cliArgs = { name: "blender", args: ["project", "new"], json: true };
    const cliLine = `run_cli_app(${JSON.stringify(cliArgs)})`;
    render(
      <AgentActivityCluster
        messages={[
          {
            id: "t-search",
            role: "tool",
            kind: "trace",
            content: 'web_search({"query":"nanobot architecture"})',
            traces: ['web_search({"query":"nanobot architecture"})'],
            createdAt: 1,
          },
          {
            id: "t-cli",
            role: "tool",
            kind: "trace",
            content: cliLine,
            traces: [cliLine],
            toolEvents: [{
              phase: "end",
              call_id: "call-blender",
              name: "run_cli_app",
              arguments: cliArgs,
            }],
            createdAt: 2,
          },
          {
            id: "t-fetch",
            role: "tool",
            kind: "trace",
            content: 'web_fetch({"url":"https://example.com/diagram"})',
            traces: ['web_fetch({"url":"https://example.com/diagram"})'],
            createdAt: 3,
          },
        ]}
        isTurnStreaming
        hasBodyBelow={false}
        cliApps={[BLENDER_CLI_APP]}
      />,
    );

    const searchRow = screen.getByText("Searching").closest("li");
    const cliRow = screen.getByText(/@blender/).closest("li");
    const fetchRow = screen.getByText("Reading").closest("li");

    expect(searchRow).not.toBeNull();
    expect(cliRow).not.toBeNull();
    expect(fetchRow).not.toBeNull();
    expect(searchRow!.compareDocumentPosition(cliRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cliRow!.compareDocumentPosition(fetchRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("labels rejected CLI app calls as failed instead of ran", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-cli-fail",
          role: "tool",
          kind: "trace",
          content: 'run_cli_app({"name":"github","args":["repo","view"],"json":"true"})',
          traces: ['run_cli_app({"name":"github","args":["repo","view"],"json":"true"})'],
          toolEvents: [
            {
              phase: "error",
              call_id: "call-github",
              name: "run_cli_app",
              arguments: { name: "github", args: ["repo", "view"], json: "true" },
              error: "Error: CLI app 'github' not found",
            },
          ],
          createdAt: 1,
        }]}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("Failed");
    expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("@github");
    expect(screen.getByTestId("activity-cli-runs")).toHaveTextContent("Error: CLI app 'github' not found");
    expect(screen.queryByText("Ran CLI")).not.toBeInTheDocument();
  });

  it("renders MCP preset tool calls as branded activity rows", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-mcp",
          role: "tool",
          kind: "trace",
          content: "mcp_browserbase_browser_navigate()",
          traces: ["mcp_browserbase_browser_navigate({\"url\":\"https://example.com\"})"],
          toolEvents: [
            {
              phase: "start",
              call_id: "call-browserbase",
              name: "mcp_browserbase_browser_navigate",
              arguments: { url: "https://example.com" },
            },
          ],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
        mcpPresets={[BROWSERBASE_MCP]}
      />,
    );

    const mcpRuns = screen.getByTestId("activity-mcp-runs");
    expect(mcpRuns).toHaveTextContent("Using");
    expect(mcpRuns).toHaveTextContent("Browserbase");
    expect(mcpRuns).toHaveTextContent("browser_navigate");
    expect(mcpRuns).toHaveTextContent("url: https://example.com");
    expect(screen.getByTestId("activity-mcp-logo-browserbase")).toBeInTheDocument();
    expect(screen.queryByText(/mcp_browserbase_browser_navigate/)).not.toBeInTheDocument();
  });

  it("renders public web fetch traces with the site favicon", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-web-fetch",
          role: "tool",
          kind: "trace",
          content: 'web_fetch({"url":"https://auth0.com/blog/jwt-security-best-practices"})',
          traces: ['web_fetch({"url":"https://auth0.com/blog/jwt-security-best-practices"})'],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );

    const favicon = screen.getByTestId("activity-web-favicon-auth0.com");
    expect(favicon.querySelector("img")?.getAttribute("src")).toContain("auth0.com");
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("auth0.com/blog/jwt-security-best-practices")).toBeInTheDocument();
  });

  it("renders plain-text fetch progress with the site favicon", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-web-fetch-text",
          role: "tool",
          kind: "trace",
          content: "Fetching https://auth0.com/blog/jwt-security-best-practices",
          traces: ["Fetching https://auth0.com/blog/jwt-security-best-practices"],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByTestId("activity-web-favicon-auth0.com")).toBeInTheDocument();
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("auth0.com/blog/jwt-security-best-practices")).toBeInTheDocument();
  });

  it("does not request favicons for private web fetch targets", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-web-fetch-local",
          role: "tool",
          kind: "trace",
          content: 'web_fetch({"url":"http://localhost:3000/dashboard"})',
          traces: ['web_fetch({"url":"http://localhost:3000/dashboard"})'],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );

    expect(screen.queryByTestId("activity-web-favicon-localhost")).not.toBeInTheDocument();
    expect(screen.getByText("url: http://localhost:3000/dashboard")).toBeInTheDocument();
  });

  it("summarizes long shell traces instead of dumping scripts", () => {
    const command = [
      "cat << 'EOF' | bash",
      "SECRET_TOKEN=sk-test",
      "for id in m1 m2 m3; do",
      "  echo done $id",
      "done",
      "EOF",
    ].join("\n");
    const line = `exec(${JSON.stringify({ command })})`;
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-shell",
          role: "tool",
          kind: "trace",
          content: line,
          traces: [line],
          createdAt: 1,
        }]}
        isTurnStreaming={false}
        hasBodyBelow
      />,
    );

    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText(/cat << 'EOF' \| bash · script, 6 lines/)).toBeInTheDocument();
    expect(screen.queryByText(/SECRET_TOKEN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/for id in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Done$/)).not.toBeInTheDocument();
  });

  it("does not render zero diff counters for completed edits", () => {
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
            phase: "end",
            added: 0,
            deleted: 0,
            approximate: false,
            status: "done",
          }],
          createdAt: 3,
        })}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.queryByText("-0")).not.toBeInTheDocument();
  });

  it("drops stale pathless pending edits after the turn completes", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t1",
          role: "tool",
          kind: "trace",
          content: "",
          traces: [],
          fileEdits: [{
            call_id: "call-edit",
            tool: "edit_file",
            path: "",
            phase: "start",
            added: 98,
            deleted: 0,
            approximate: true,
            status: "editing",
            pending: true,
          }],
          createdAt: 1,
        }]}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /preparing edit/i })).not.toBeInTheDocument();
    expect(screen.queryByText("+98")).not.toBeInTheDocument();
    expect(screen.queryByText("0 tool calls")).not.toBeInTheDocument();
  });

  it("renders pending file edit placeholders before the path is known", () => {
    render(
      <AgentActivityCluster
        messages={activityMessages("", {
          id: "t2",
          role: "tool",
          kind: "trace",
          content: "",
          traces: [],
          fileEdits: [{
            call_id: "call-edit",
            tool: "edit_file",
            path: "",
            phase: "start",
            added: 0,
            deleted: 0,
            approximate: true,
            status: "editing",
            pending: true,
          }],
          createdAt: 3,
        })}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByText("Preparing file edit…")).toBeInTheDocument();
  });

  it("shows the reason when a file edit fails", () => {
    render(
      <AgentActivityCluster
        messages={activityMessages("", {
          id: "t2",
          role: "tool",
          kind: "trace",
          content: "apply_patch()",
          traces: ["apply_patch()"],
          fileEdits: [{
            call_id: "call-patch",
            tool: "apply_patch",
            path: "angry-birds.html",
            phase: "error",
            added: 0,
            deleted: 0,
            approximate: false,
            status: "error",
            error: "Error applying patch: old_text not found in angry-birds.html",
          }],
          createdAt: 3,
        })}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByText("Target text was not found in angry-birds.html.")).toBeInTheDocument();
  });

  it("keeps permission errors readable for failed file edits", () => {
    render(
      <AgentActivityCluster
        messages={activityMessages("", {
          id: "t2",
          role: "tool",
          kind: "trace",
          content: "write_file()",
          traces: ["write_file()"],
          fileEdits: [{
            call_id: "call-write",
            tool: "write_file",
            path: "/Users/renxubin/.nanobot/workspace/agent-research-video/composition.html",
            phase: "error",
            added: 0,
            deleted: 0,
            approximate: false,
            status: "error",
            error: "Error writing file: [Errno 13] Permission denied: '/Users/renxubin'",
          }],
          createdAt: 3,
        })}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByText("No permission to change this location.")).toBeInTheDocument();
    expect(screen.queryByText(/\[Errno 13\]/)).not.toBeInTheDocument();
  });

  it("merges repeated edits for the same path and lets successful edits win over failures", () => {
    render(
      <AgentActivityCluster
        messages={activityMessages("", {
          id: "t2",
          role: "tool",
          kind: "trace",
          content: "edit_file()",
          traces: ["edit_file()"],
          fileEdits: [
            {
              call_id: "call-edit-1",
              tool: "edit_file",
              path: "minecraft-fps/index.html",
              phase: "end",
              added: 2,
              deleted: 1,
              approximate: false,
              status: "done",
            },
            {
              call_id: "call-edit-2",
              tool: "edit_file",
              path: "minecraft-fps/index.html",
              phase: "error",
              added: 0,
              deleted: 0,
              approximate: false,
              status: "error",
              error: "patch failed",
            },
            {
              call_id: "call-edit-3",
              tool: "edit_file",
              path: "minecraft-fps/index.html",
              phase: "end",
              added: 6,
              deleted: 6,
              approximate: false,
              status: "done",
            },
          ],
          createdAt: 3,
        })}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );

    const fileRefs = screen.getAllByTestId("activity-file-reference");
    expect(fileRefs).toHaveLength(1);
    expect(fileRefs[0]).toHaveTextContent("minecraft-fps/index.html");
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.getAllByText("+8").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-7").length).toBeGreaterThan(0);
  });

  it("renders tool event embeds as inline activity evidence", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-evidence",
          role: "tool",
          kind: "trace",
          content: 'web_fetch({"url":"https://example.com"})',
          traces: ['web_fetch({"url":"https://example.com"})'],
          toolEvents: [{
            phase: "end",
            call_id: "call-fetch",
            name: "web_fetch",
            arguments: { url: "https://example.com" },
            embeds: [{
              url: "/api/media/signed/screenshot.png",
              name: "Homepage screenshot",
              type: "image/png",
            }],
          }],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByTestId("activity-evidence-preview")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Homepage screenshot" })).toHaveAttribute(
      "src",
      "/api/media/signed/screenshot.png",
    );
  });

  it("shows missing evidence as a file-safe placeholder", () => {
    render(
      <AgentActivityCluster
        messages={[{
          id: "t-missing-evidence",
          role: "tool",
          kind: "trace",
          content: 'screenshot({"path":"missing.png"})',
          traces: ['screenshot({"path":"missing.png"})'],
          toolEvents: [{
            phase: "end",
            call_id: "call-shot",
            name: "screenshot",
            arguments: { path: "missing.png" },
            files: [{ name: "missing.png", type: "image/png" }],
          }],
          createdAt: 1,
        }]}
        isTurnStreaming
        hasBodyBelow={false}
      />,
    );

    expect(screen.getByTestId("activity-evidence-preview")).toBeInTheDocument();
    expect(screen.getByText("missing.png")).toBeInTheDocument();
  });
});
