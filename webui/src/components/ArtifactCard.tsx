import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Copy, CopyCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/format";
import { splitFilePath } from "@/components/FileReferenceChip";
import { useClient } from "@/providers/ClientProvider";
import { fetchFilePreview } from "@/lib/api";

export type ArtifactFileKind = "markdown" | "html" | "code" | "text" | "word" | "pdf" | "image" | "generic";

interface ArtifactCardProps {
  path: string;
  tooltipPath?: string;
  display?: string;
  createdAt?: number;
  /** File size in bytes. */
  size?: number;
  onOpen?: (path: string) => void;
  className?: string;
  testId?: string;
}

/** Only render cards for files under outputs/<session_id>/... */
function isOutputsSessionFile(path: string): boolean {
  return /outputs\/[^/]+\/.+/.test(path);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function artifactFileKind(path: string): ArtifactFileKind {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "md":
    case "mdx":
      return "markdown";
    case "html":
    case "htm":
      return "html";
    case "txt":
    case "log":
    case "csv":
      return "text";
    case "json":
    case "yml":
    case "yaml":
    case "toml":
    case "py":
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
    case "css":
    case "scss":
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "xml":
    case "sql":
    case "graphql":
    case "gql":
    case "proto":
    case "rs":
    case "go":
    case "java":
    case "kt":
    case "swift":
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "rb":
    case "php":
    case "lua":
    case "r":
    case "dart":
    case "ex":
    case "exs":
    case "elm":
    case "erl":
    case "hrl":
    case "hs":
    case "scala":
    case "clj":
    case "cljs":
    case "edn":
    case "nim":
    case "zig":
    case "vue":
    case "svelte":
    case "astro":
    case "tf":
    case "hcl":
    case "dockerfile":
    case "env":
    case "ini":
    case "cfg":
    case "conf":
    case "lock":
    case "makefile":
    case "cmake":
      return "code";
    case "doc":
    case "docx":
      return "word";
    case "pdf":
      return "pdf";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "bmp":
    case "ico":
      return "image";
    default:
      return "generic";
  }
}

function artifactFileColor(kind: ArtifactFileKind): string {
  switch (kind) {
    case "markdown":
      return "#6e5494";
    case "html":
      return "#e37400";
    case "code":
      return "#f5a623";
    case "text":
      return "#5f6368";
    case "word":
      return "#1a73e8";
    case "pdf":
      return "#ea4335";
    case "image":
      return "#34a853";
    default:
      return "#666";
  }
}

export function ArtifactCard({
  path,
  tooltipPath,
  display,
  createdAt,
  size,
  onOpen,
  className,
  testId = "artifact-card",
}: ArtifactCardProps) {
  if (!isOutputsSessionFile(path)) return null;

  const { token } = useClient();
  const { name } = splitFilePath(path);
  const sessionKey = path.match(/outputs\/([^/]+)\//)?.[1] ?? "";
  const [fetchedSize, setFetchedSize] = useState<number | null>(null);
  const effectiveSize = size ?? fetchedSize ?? undefined;

  useEffect(() => {
    if (size != null || !token || !sessionKey) return;
    let cancelled = false;
    fetchFilePreview(token, sessionKey, path).then((payload) => {
      if (!cancelled) setFetchedSize(payload.size);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [path, token, sessionKey, size]);
  const kind = artifactFileKind(path);
  const title = display || name;
  const fullPath = tooltipPath || path;
  const targetPath = tooltipPath || path;
  const interactive = Boolean(onOpen);
  const [copied, setCopied] = useState(false);

  const openPreview = (event: MouseEvent | KeyboardEvent) => {
    if (!onOpen) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(targetPath);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    openPreview(event);
  };

  const copyPath = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(fullPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [fullPath]);

  return (
    <span
      className={cn(
        "group relative artifact-card-flow not-prose my-2 block w-full max-w-[28rem] rounded-xl",
        "border-2 border-border bg-card/50 transition-all hover:border-foreground/25 hover:shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        data-testid={testId}
        aria-label={fullPath}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? openPreview : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        className={cn(
          "flex w-full items-start gap-3 bg-transparent p-3 text-left",
          interactive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
        )}
      >
        <span className="shrink-0 pt-0.5" style={{ color: artifactFileColor(kind) }}>
          <ArtifactFileIcon kind={kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {createdAt != null && Number.isFinite(createdAt) || effectiveSize != null && Number.isFinite(effectiveSize) ? (
            <span className="mt-0.5 block text-[11px] text-muted-foreground/60 tabular-nums">
              {effectiveSize != null && Number.isFinite(effectiveSize) ? (
                <>
                  {formatFileSize(effectiveSize)}
                  {createdAt != null && Number.isFinite(createdAt) && (
                    <span className="tabular-nums">{` · ${formatMessageTime(createdAt)}`}</span>
                  )}
                </>
              ) : (
                formatMessageTime(createdAt!)
              )}
            </span>
          ) : null}
        </span>
      </button>
      <span
        className={cn(
          "flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5",
        )}
      >
        <span
          className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground/70 group-hover:overflow-visible group-hover:whitespace-normal group-hover:[direction:ltr]"
          dir="rtl"
          style={{ textOverflow: "ellipsis" }}
        >
          <span dir="ltr">{fullPath}</span>
        </span>
        <button
          type="button"
          aria-label="Copy path"
          className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
          onClick={copyPath}
        >
          {copied ? (
            <CopyCheck className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </span>
    </span>
  );
}

function ArtifactFileIcon({ kind }: { kind: ArtifactFileKind }) {
  switch (kind) {
    case "markdown":
      return <MarkdownIcon />;
    case "html":
      return <HtmlIcon />;
    case "code":
      return <CodeIcon />;
    case "text":
      return <TextIcon />;
    case "word":
      return <WordIcon />;
    case "pdf":
      return <PdfIcon />;
    case "image":
      return <ImageIcon />;
    default:
      return <GenericFileIcon />;
  }
}

function MarkdownIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 1705 960"
      fill="currentColor"
    >
      <path d="M15 90 L240 90 L480 310 L720 90 L945 90 L945 900 L720 900 L720 470 L480 700 L240 470 L240 900 L15 900 Z" />
      <path d="M1260 90 L1445 90 L1445 560 L1690 560 L1352 900 L1015 560 L1260 560 Z" />
    </svg>
  );
}

function HtmlIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m18 16 4-4-4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m14.5 4-5 16" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M8 10h8" />
      <path d="M8 13h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

function WordIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="m14.5 12.5-5 5" />
      <path d="m9.5 12.5 5 5" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9.8V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M9 17v-2a2 2 0 0 0-4 0v2" />
      <rect width="8" height="5" x="3" y="17" rx="1" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function GenericFileIcon() {
  return (
    <svg
      aria-hidden
      className="h-7 w-7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}
