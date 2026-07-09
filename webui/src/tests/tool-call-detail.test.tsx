import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallDetail } from "@/components/thread/activity/ToolCallDetail";
import type { ToolProgressEvent } from "@/lib/types";

function makeEvent(overrides: Partial<ToolProgressEvent> = {}): ToolProgressEvent {
  return {
    version: 1,
    phase: "end",
    call_id: "call_1",
    name: "read_file",
    arguments: { path: "/foo/bar.txt", limit: 100 },
    result: "file contents here",
    ...overrides,
  };
}

describe("ToolCallDetail", () => {
  it("renders nothing when no args and no result", () => {
    const { container } = render(
      <ToolCallDetail event={makeEvent({ arguments: undefined, result: undefined })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders toggle button when args exist", () => {
    render(<ToolCallDetail event={makeEvent()} />);
    expect(screen.getByText("Show details")).toBeInTheDocument();
  });

  it("shows arguments and result when expanded", () => {
    render(<ToolCallDetail event={makeEvent()} />);
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
    // JSON content should be visible in the pre blocks
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });

  it("shows 'Running...' for phase=start events", () => {
    render(<ToolCallDetail event={makeEvent({ phase: "start", result: undefined })} />);
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.queryByText("Result")).toBeNull();
  });

  it("shows Error label for phase=error events", () => {
    render(
      <ToolCallDetail
        event={makeEvent({ phase: "error", result: undefined, error: "something failed" })}
      />,
    );
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows 'Hide details' when expanded", () => {
    render(<ToolCallDetail event={makeEvent()} />);
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("Hide details")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Hide details"));
    expect(screen.getByText("Show details")).toBeInTheDocument();
  });

  it("handles string result", () => {
    render(<ToolCallDetail event={makeEvent({ result: "plain text result" })} />);
    fireEvent.click(screen.getByText("Show details"));
    expect(screen.getByText("plain text result")).toBeInTheDocument();
  });

  it("handles empty object arguments (no args section)", () => {
    render(<ToolCallDetail event={makeEvent({ arguments: {}, result: "ok" })} />);
    // Should still render because result exists
    expect(screen.getByText("Show details")).toBeInTheDocument();
  });
});
