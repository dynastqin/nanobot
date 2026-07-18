import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArtifactCard, artifactFileKind } from "@/components/ArtifactCard";

vi.mock("@/lib/api", () => ({
  fetchFilePreview: vi.fn().mockResolvedValue({ size: 2048 }),
}));

vi.mock("@/providers/ClientProvider", () => ({
  useClient: () => ({ token: "mock-token", client: {} as never, modelName: null }),
}));

describe("ArtifactCard", () => {
  it("renders title and timestamp", () => {
    const createdAt = new Date("2026-06-28T17:18:29").getTime();
    render(
      <ArtifactCard
        path="outputs/sess-123/report.md"
        display="Report"
        createdAt={createdAt}
      />,
    );

    const card = screen.getByTestId("artifact-card");
    expect(card).toHaveTextContent("Report");
    expect(card).toHaveTextContent("2026/06/28 17:18:29");
    // Full path only visible in hover bar
    expect(screen.getByText("outputs/sess-123/report.md")).toBeInTheDocument();
  });

  it("uses basename as title when display is not provided", () => {
    render(<ArtifactCard path="outputs/sess-123/report.md" />);

    expect(screen.getByTestId("artifact-card")).toHaveTextContent("report.md");
  });

  it("truncates long title with ellipsis", () => {
    render(
      <ArtifactCard
        path="outputs/sess-123/very-long-report-name-that-would-need-truncation.md"
      />,
    );

    const card = screen.getByTestId("artifact-card");
    expect(card).toHaveTextContent("very-long-report-name-that-would-need-truncation.md");
  });

  it("calls onOpen with the correct path on click", () => {
    const onOpen = vi.fn();
    render(
      <ArtifactCard
        path="outputs/sess-123/report.md"
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByTestId("artifact-card"));
    expect(onOpen).toHaveBeenCalledWith("outputs/sess-123/report.md");
  });

  it("calls onOpen with tooltipPath when provided", () => {
    const onOpen = vi.fn();
    render(
      <ArtifactCard
        path="outputs/sess-123/report.md"
        tooltipPath="/abs/path/outputs/sess-123/report.md"
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByTestId("artifact-card"));
    expect(onOpen).toHaveBeenCalledWith("/abs/path/outputs/sess-123/report.md");
  });

  it("does not render timestamp when createdAt is undefined", () => {
    render(<ArtifactCard path="outputs/sess-123/report.md" />);

    const card = screen.getByTestId("artifact-card");
    expect(card).not.toHaveTextContent(/\d{4}\/\d{2}\/\d{2}/);
  });

  it("responds to Enter key", () => {
    const onOpen = vi.fn();
    render(
      <ArtifactCard
        path="outputs/sess-123/report.md"
        onOpen={onOpen}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("artifact-card"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("outputs/sess-123/report.md");
  });

  it("responds to Space key", () => {
    const onOpen = vi.fn();
    render(
      <ArtifactCard
        path="outputs/sess-123/report.md"
        onOpen={onOpen}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("artifact-card"), { key: " " });
    expect(onOpen).toHaveBeenCalledWith("outputs/sess-123/report.md");
  });

  it("does not respond to other keys", () => {
    const onOpen = vi.fn();
    render(
      <ArtifactCard
        path="outputs/sess-123/report.md"
        onOpen={onOpen}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("artifact-card"), { key: "Escape" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("artifactFileKind", () => {
  it("detects markdown", () => {
    expect(artifactFileKind("readme.md")).toBe("markdown");
    expect(artifactFileKind("docs/guide.mdx")).toBe("markdown");
  });

  it("detects html", () => {
    expect(artifactFileKind("index.html")).toBe("html");
    expect(artifactFileKind("page.htm")).toBe("html");
  });

  it("detects text", () => {
    expect(artifactFileKind("notes.txt")).toBe("text");
    expect(artifactFileKind("app.log")).toBe("text");
    expect(artifactFileKind("data.csv")).toBe("text");
  });

  it("detects code", () => {
    expect(artifactFileKind("data.json")).toBe("code");
    expect(artifactFileKind("config.yaml")).toBe("code");
    expect(artifactFileKind("config.toml")).toBe("code");
    expect(artifactFileKind("app.py")).toBe("code");
    expect(artifactFileKind("app.js")).toBe("code");
    expect(artifactFileKind("app.ts")).toBe("code");
    expect(artifactFileKind("app.jsx")).toBe("code");
    expect(artifactFileKind("app.tsx")).toBe("code");
    expect(artifactFileKind("style.css")).toBe("code");
    expect(artifactFileKind("Dockerfile")).toBe("code");
  });

  it("detects word", () => {
    expect(artifactFileKind("report.doc")).toBe("word");
    expect(artifactFileKind("report.docx")).toBe("word");
  });

  it("detects pdf", () => {
    expect(artifactFileKind("invoice.pdf")).toBe("pdf");
  });

  it("detects image", () => {
    expect(artifactFileKind("photo.png")).toBe("image");
    expect(artifactFileKind("photo.jpg")).toBe("image");
    expect(artifactFileKind("photo.jpeg")).toBe("image");
    expect(artifactFileKind("icon.svg")).toBe("image");
    expect(artifactFileKind("animation.gif")).toBe("image");
    expect(artifactFileKind("photo.webp")).toBe("image");
    expect(artifactFileKind("photo.bmp")).toBe("image");
    expect(artifactFileKind("favicon.ico")).toBe("image");
  });

  it("falls back to generic for unknown extensions", () => {
    expect(artifactFileKind("archive.zip")).toBe("generic");
    expect(artifactFileKind("data.bin")).toBe("generic");
    expect(artifactFileKind("file.unknown")).toBe("generic");
  });
});
