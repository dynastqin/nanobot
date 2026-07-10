import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentActivityCluster, TraceActivityCard } from "@/components/thread/AgentActivityCluster";
import type { UIMessage } from "@/lib/types";

function traceMsg(id: string, line: string, eventOverrides: Partial<UIMessage["toolEvents"] extends (infer E)[] | undefined ? E : never> = {}): UIMessage {
  const name = line.split("(", 1)[0];
  let args: unknown = {};
  try {
    const m = /\((.+)\)$/.exec(line)?.[1];
    if (m) args = JSON.parse(m);
  } catch { /* keep empty */ }
  return {
    id, role: "tool", kind: "trace",
    content: line,
    traces: [line],
    toolEvents: [{
      phase: "end" as const,
      call_id: `call-${id}`,
      name,
      arguments: args,
      result: { ok: true },
      ...eventOverrides,
    }],
    createdAt: Date.now(),
  };
}

describe("Show details regression", () => {
  it("shows 'Show details' for a completed shell tool call through AgentActivityCluster", () => {
    const traceLine = 'shell({"command":"curl -s \\"wttr.in/Hangzhou?T&m&lang=zh\\""})';
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "let me check weather", createdAt: 1 },
      {
        id: "t1", role: "tool", kind: "trace",
        content: traceLine,
        traces: [traceLine],
        toolEvents: [{
          phase: "end",
          call_id: "call-shell-1",
          name: "shell",
          arguments: { command: 'curl -s "wttr.in/Hangzhou?T&m&lang=zh"' },
          result: "Hangzhou: ⛅️ +28°C",
        }],
        createdAt: 2,
      },
    ];
    render(
      <AgentActivityCluster
        messages={messages}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );
    expect(screen.getByText("Command")).toBeInTheDocument();
    const showDetails = screen.queryByRole("button", { name: /show details/i });
    expect(showDetails).toBeInTheDocument();
  });

  it("shows 'Show details' and expands for a read tool call", () => {
    const msg = traceMsg("t-read", 'read({"path":"/tmp/test.txt"})', {
      result: "file content here",
    });
    render(
      <TraceActivityCard
        message={msg}
        active={false}
        cliAppsByName={new Map()}
        mcpPresetsByName={new Map()}
      />,
    );
    expect(screen.getByText("Reading")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /show details/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("shows 'Show details' for shell command with active=false", () => {
    const msg = traceMsg("t-shell", 'shell({"command":"ls -la"})', {
      result: "total 42\ndrwxr-xr-x ...",
    });
    render(
      <TraceActivityCard
        message={msg}
        active={false}
        cliAppsByName={new Map()}
        mcpPresetsByName={new Map()}
      />,
    );
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show details/i })).toBeInTheDocument();
  });

  it("shows 'Show details' for multiple tool calls through AgentActivityCluster", () => {
    const messages: UIMessage[] = [
      { id: "r1", role: "assistant", content: "", reasoning: "thinking...", createdAt: 1 },
      traceMsg("t-read", 'read({"path":"/tmp/data.txt"})', { result: "data" }),
      { id: "r2", role: "assistant", content: "", reasoning: "more thinking...", createdAt: 3 },
      traceMsg("t-shell", 'shell({"command":"cat /tmp/data.txt"})', { result: "data" }),
    ];
    render(
      <AgentActivityCluster
        messages={messages}
        isTurnStreaming={false}
        hasBodyBelow={false}
      />,
    );
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    const detailButtons = screen.getAllByRole("button", { name: /show details/i });
    expect(detailButtons.length).toBe(2);

    // Click first "Show details" and verify args/result appear
    fireEvent.click(detailButtons[0]);
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });
});
