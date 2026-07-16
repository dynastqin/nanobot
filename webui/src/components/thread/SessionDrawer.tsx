import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  Bot,
  Code2,
  Copy,
  Download,
  Eye,
  GripVertical,
  Loader2,
  Maximize2,
  PanelRight,
  RefreshCcw,
  CircleAlert,
  Check,
  CalendarClock,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ArtifactShareButton } from "@/components/ArtifactShareButton";
import { FilePreviewContent, isRenderableFile, type ViewMode } from "@/components/FilePreviewContent";
import { FileTreeNode } from "@/components/FileTree";
import { AgentActivityCluster, type SubagentGroup } from "@/components/thread/AgentActivityCluster";
import { useSessionAutomationJobs } from "@/hooks/useSessionAutomationJobs";
import { ApiError, downloadFile, fetchFilePreview, fetchWorkspaceFiles, type ArtifactShareResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CliAppInfo, FilePreviewPayload, McpPresetInfo, WorkspaceFileNode } from "@/lib/types";
import {
  AutomationRow,
} from "@/components/thread/SessionInfoPopover";

type Tab = "files" | "automations" | "agents";

interface SessionDrawerProps {
  sessionKey: string;
  token: string;
  open: boolean;
  desktopWidth?: number;
  isClosing?: boolean;
  autoOpenFile?: string;
  autoOpenFileSeq?: number;
  autoOpenSubagentTaskId?: string;
  subagentGroups?: SubagentGroup[];
  isTurnStreaming?: boolean;
  cliApps?: CliAppInfo[];
  mcpPresets?: McpPresetInfo[];
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClose: () => void;
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
  onOpenFileFullscreen: (path: string, share?: ArtifactShareResult | null) => void;
}

export function SessionDrawer({
  sessionKey,
  token,
  open,
  desktopWidth = 448,
  isClosing = false,
  autoOpenFile,
  autoOpenFileSeq,
  autoOpenSubagentTaskId,
  subagentGroups = [],
  isTurnStreaming = false,
  cliApps = [],
  mcpPresets = [],
  onResizeStart,
  onClose,
  onOpenFilePreview,
  onOpenLink,
  onOpenFileFullscreen,
}: SessionDrawerProps) {
  const { t } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<Tab>("files");
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (autoOpenSubagentTaskId) {
      setActiveTab("agents");
    }
  }, [autoOpenSubagentTaskId]);

  if (!open) return null;

  return (
    <aside
      aria-label={t("thread.header.sessionInfo", { defaultValue: "Session details" })}
      style={{
        "--file-preview-width": `${desktopWidth}px`,
        "--file-preview-slot-width": !entered || isClosing ? "0px" : `${desktopWidth}px`,
      } as CSSProperties}
      className={cn(
        "absolute inset-y-0 right-0 z-30 w-[min(100vw,var(--file-preview-slot-width))] overflow-hidden",
        "transition-[width] duration-300 ease-out will-change-[width]",
        "md:relative md:z-auto md:w-[var(--file-preview-slot-width)] md:min-w-0 md:shrink-0",
        isClosing && "pointer-events-none",
      )}
      data-file-preview-panel
    >
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-[min(100vw,var(--file-preview-width))] flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] md:w-[var(--file-preview-width)] md:pb-0",
          "border-l border-border/70 bg-background shadow-2xl md:shadow-none",
          "transition-[opacity,transform] duration-300 ease-out will-change-transform",
          !entered || isClosing ? "translate-x-full opacity-0" : "translate-x-0 opacity-100",
          "motion-reduce:translate-x-0",
        )}
      >
        {onResizeStart ? (
          <button
            type="button"
            aria-label="Resize session panel"
            className={cn(
              "group absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none md:flex",
              "items-stretch justify-center focus-visible:outline-none",
            )}
            onPointerDown={onResizeStart}
          >
            <span
              aria-hidden
              className={cn(
                "h-full w-px bg-foreground/25 opacity-0 transition-opacity",
                "group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100",
              )}
            />
          </button>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Tab bar with toolbar */}
          <div className="flex shrink-0 items-center border-b border-border/45 px-3">
            <button
              type="button"
              className={cn(
                "py-2.5 mr-6 text-[13px] font-medium transition-colors border-b-2",
                activeTab === "files"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("files")}
            >
              {t("thread.sessionInfo.tabs.files")}
            </button>
            {subagentGroups.length > 0 && (
              <button
                type="button"
                className={cn(
                  "py-2.5 mr-6 text-[13px] font-medium transition-colors border-b-2",
                  activeTab === "agents"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setActiveTab("agents")}
              >
                {t("thread.sessionInfo.tabs.agents", { defaultValue: "Agents" })}
              </button>
            )}
            <button
              type="button"
              className={cn(
                "py-2.5 text-[13px] font-medium transition-colors border-b-2",
                activeTab === "automations"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("automations")}
            >
              {t("thread.sessionInfo.tabs.automations")}
            </button>
            <div className="flex-1" />
            {activeTab === "files" ? (
              <FilesTabToolbar
                sessionKey={sessionKey}
                token={token}
                onClose={onClose}
                t={t}
              />
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={onClose}
                aria-label={t("filePreview.close", { defaultValue: "Close" })}
              >
                <X className="h-4 w-4 stroke-[1.75]" />
              </Button>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === "files" ? (
              <FilesTab
                sessionKey={sessionKey}
                token={token}
                autoOpenFile={autoOpenFile}
                autoOpenFileSeq={autoOpenFileSeq}
                onOpenFileFullscreen={onOpenFileFullscreen}
              />
            ) : activeTab === "agents" ? (
              <AgentsTab
                subagentGroups={subagentGroups}
                autoOpenSubagentTaskId={autoOpenSubagentTaskId}
                isTurnStreaming={isTurnStreaming}
                cliApps={cliApps}
                mcpPresets={mcpPresets}
                onOpenFilePreview={onOpenFilePreview}
                onOpenLink={onOpenLink}
              />
            ) : (
              <AutomationsTab
                sessionKey={sessionKey}
                token={token}
                open={open}
              />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Files Tab Toolbar                                                   */
/* ------------------------------------------------------------------ */

function FilesTabToolbar({
  sessionKey,
  token,
  onClose,
  t,
}: {
  sessionKey: string;
  token: string;
  onClose: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchWorkspaceFiles(token, sessionKey);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
    // Trigger reload via a custom event so FilesTab can listen
    window.dispatchEvent(new CustomEvent("workspace-files-refresh", { detail: sessionKey }));
  }, [token, sessionKey]);

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label={t("thread.sessionInfo.files.refresh", { defaultValue: "Refresh file tree" })}
      >
        <RefreshCcw className={cn("h-4 w-4 stroke-[1.75]", refreshing && "animate-spin")} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full"
        onClick={onClose}
        aria-label={t("filePreview.close", { defaultValue: "Close" })}
      >
        <X className="h-4 w-4 stroke-[1.75]" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Files Tab                                                          */
/* ------------------------------------------------------------------ */

const FILE_TREE_DEFAULT_WIDTH = 220;
const FILE_TREE_MIN_WIDTH = 120;

// Scroll the currently-selected file tree node into view inside a container.
// Looks up the node by data attribute after React has committed the tree update
// (so ancestors are auto-expanded and the selected node is in the DOM).
function revealSelectedInTree(container: HTMLElement | null) {
  if (!container) return;
  const node = container.querySelector<HTMLElement>("[data-file-tree-selected='true']");
  if (!node) return;
  node.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function FilesTab({
  sessionKey,
  token,
  autoOpenFile,
  autoOpenFileSeq,
  onOpenFileFullscreen,
}: {
  sessionKey: string;
  token: string;
  autoOpenFile?: string;
  autoOpenFileSeq?: number;
  onOpenFileFullscreen: (path: string, share?: ArtifactShareResult | null) => void;
}) {
  const { t } = useTranslation("common");
  const [tree, setTree] = useState<WorkspaceFileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeWidth, setTreeWidth] = useState(FILE_TREE_DEFAULT_WIDTH);
  const treeWidthRef = useRef(FILE_TREE_DEFAULT_WIDTH);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewUnsupported, setPreviewUnsupported] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Latest pending auto-open request. Updated on every click, consumed when the
  // tree is ready. Lets us distinguish "user just clicked this file" (reveal +
  // scroll) from "already handled".
  const pendingAutoOpenRef = useRef<{ path: string; seq: number } | null>(null);
  const lastAutoOpenSeqRef = useRef<number>(0);

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const payload = await fetchWorkspaceFiles(token, sessionKey);
      setTree(payload.tree);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token, sessionKey]);

  // Build a path→share lookup from tree nodes
  const shareMap = useMemo(() => {
    const map: Record<string, ArtifactShareResult> = {};
    function walk(node: WorkspaceFileNode) {
      if (node.share) {
        map[node.path] = node.share;
      }
      if (node.children) {
        for (const child of node.children) {
          walk(child);
        }
      }
    }
    if (tree) walk(tree);
    return map;
  }, [tree]);

  // Keep ref in sync for resize handler
  useEffect(() => {
    treeWidthRef.current = treeWidth;
  }, [treeWidth]);

  // Tree width resize handler
  const handleTreeResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const treeEl = handle.previousElementSibling as HTMLElement | null;
    if (!treeEl) return;
    const treeRect = treeEl.getBoundingClientRect();
    const leftEdge = treeRect.left;
    const originalBodyCursor = document.body.style.cursor;
    const originalBodyUserSelect = document.body.style.userSelect;
    let nextWidth = treeWidthRef.current;
    let frame: number | null = null;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyWidth = (clientX: number) => {
      nextWidth = Math.max(FILE_TREE_MIN_WIDTH, clientX - leftEdge);
      treeWidthRef.current = nextWidth;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setTreeWidth(nextWidth);
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      applyWidth(moveEvent.clientX);
    };
    const handlePointerUp = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      setTreeWidth(nextWidth);
      document.body.style.cursor = originalBodyCursor;
      document.body.style.userSelect = originalBodyUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    applyWidth(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // Listen for refresh events from toolbar
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === sessionKey) loadTree();
    };
    window.addEventListener("workspace-files-refresh", handler);
    return () => window.removeEventListener("workspace-files-refresh", handler);
  }, [loadTree, sessionKey]);

  // Update the pending auto-open request whenever the click signal changes.
  // We track the latest seq both as a state and a ref so the effect below can
  // trigger on seq while still being able to bail out on stale renders.
  const [pendingSeq, setPendingSeq] = useState<number>(0);
  useEffect(() => {
    if (!autoOpenFile || !autoOpenFileSeq) return;
    if (autoOpenFileSeq <= lastAutoOpenSeqRef.current) return;
    lastAutoOpenSeqRef.current = autoOpenFileSeq;
    pendingAutoOpenRef.current = { path: autoOpenFile, seq: autoOpenFileSeq };
    setPendingSeq(autoOpenFileSeq);
  }, [autoOpenFile, autoOpenFileSeq]);

  // React to every new auto-open request. If the tree is already loaded,
  // apply the selection + scroll immediately. If not, the tree-load effect
  // below will apply it once ready.
  useEffect(() => {
    if (!pendingSeq || !tree) return;
    const pending = pendingAutoOpenRef.current;
    if (!pending || pending.seq !== pendingSeq) return;
    setSelectedPath(pending.path);
    setTreeCollapsed(true);
    pendingAutoOpenRef.current = null;
  }, [pendingSeq, tree]);

  // When the tree loads, apply any pending auto-open that arrived while it
  // was still loading.
  useEffect(() => {
    if (!tree) return;
    const pending = pendingAutoOpenRef.current;
    if (!pending) return;
    setSelectedPath(pending.path);
    setTreeCollapsed(true);
    pendingAutoOpenRef.current = null;
  }, [tree]);

  // Reveal the selected file in the scroll container whenever selectedPath
  // changes (chat click, re-click of the same file, or manual tree click).
  useEffect(() => {
    if (!selectedPath) return;
    // Wait for React to commit the tree update (ancestors auto-expand,
    // selected node renders) before scrolling it into view.
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        revealSelectedInTree(scrollContainerRef.current);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(false);
    setPreviewUnsupported(false);
    setPreview(null);
    setViewMode("preview");
    (async () => {
      try {
        const payload = await fetchFilePreview(token, sessionKey, selectedPath);
        if (!cancelled) setPreview(payload);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 415) {
            setPreviewUnsupported(true);
          } else {
            setPreviewError(true);
          }
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedPath, token, sessionKey]);

  const handleCopy = useCallback(async () => {
    if (!preview?.content) return;
    try {
      await navigator.clipboard.writeText(preview.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [preview]);

  const handleDownload = useCallback(async () => {
    if (!selectedPath) return;
    if (preview) {
      // Text file: download the previewed content
      const blob = new Blob([preview.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const name = selectedPath.split("/").pop() || "file";
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (previewUnsupported) {
      // Binary file: download raw file from server
      try {
        await downloadFile(token, sessionKey, selectedPath);
      } catch {
        // download failed
      }
    }
  }, [preview, previewUnsupported, selectedPath, token, sessionKey]);

  const selectFile = useCallback((path: string) => {
    setSelectedPath(path);
    if (treeCollapsed) setTreeCollapsed(false);
  }, [treeCollapsed]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t("thread.sessionInfo.files.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[13px] text-destructive">
        <CircleAlert className="h-4 w-4" />
        <span>{t("thread.sessionInfo.files.error")}</span>
        <Button variant="ghost" size="sm" onClick={loadTree} className="text-[12px]">
          {t("thread.sessionInfo.files.retry", { defaultValue: "Retry" })}
        </Button>
      </div>
    );
  }

  const treeChildren = tree?.children;
  const isEmpty = !treeChildren || treeChildren.length === 0;

  if (isEmpty) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
        {t("thread.sessionInfo.files.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      {selectedPath && (
        <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border/45 bg-muted/30">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setTreeCollapsed(!treeCollapsed)}
            aria-label={treeCollapsed
              ? t("thread.sessionInfo.files.expandTree", { defaultValue: "Expand file tree" })
              : t("thread.sessionInfo.files.collapseTree", { defaultValue: "Collapse file tree" })
            }
          >
            <PanelRight className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1" />
          {preview && isRenderableFile(preview.language) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode(viewMode === "preview" ? "source" : "preview")}
              aria-label={viewMode === "preview" ? t("thread.sessionInfo.files.viewSource") : t("thread.sessionInfo.files.viewPreview")}
            >
              {viewMode === "preview" ? (
                <Code2 className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
            disabled={!preview || previewLoading}
            aria-label={t("thread.sessionInfo.files.copyContent")}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDownload}
            disabled={(!preview && !previewUnsupported) || previewLoading}
            aria-label={t("thread.sessionInfo.files.download")}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          {selectedPath && selectedPath.includes("outputs/") && (
            <ArtifactShareButton
              key={selectedPath}
              token={token}
              sessionKey={sessionKey}
              filePath={selectedPath}
              variant="icon-sm"
              initialShare={shareMap[selectedPath] ?? null}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (selectedPath) onOpenFileFullscreen(selectedPath, shareMap[selectedPath] ?? null);
            }}
            disabled={!preview || previewLoading}
            aria-label={t("thread.sessionInfo.files.openFullscreen")}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Tree */}
        <div
          ref={scrollContainerRef}
          className={cn(
            "overflow-y-auto border-r border-border/45 transition-[width] duration-200 ease-out",
            treeCollapsed ? "w-0 border-r-0" : "",
          )}
          style={{ width: treeCollapsed ? 0 : treeWidth }}
        >
          <div className="py-2" style={{ minWidth: treeWidth }}>
            {treeChildren.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={0}
                selectedPath={selectedPath}
                onSelect={selectFile}
              />
            ))}
          </div>
        </div>

        {/* Tree resize handle */}
        {!treeCollapsed && (
          <button
            type="button"
            aria-label={t("thread.sessionInfo.files.resizeTree", { defaultValue: "Resize file tree" })}
            className={cn(
              "group relative shrink-0 w-3 -ml-px cursor-col-resize touch-none",
              "flex items-center justify-center focus-visible:outline-none",
            )}
            onPointerDown={handleTreeResizeStart}
          >
            <span
              aria-hidden
              className={cn(
                "h-full w-px bg-foreground/25 opacity-0 transition-opacity",
                "group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100",
              )}
            />
            <GripVertical
              aria-hidden
              className="absolute h-4 w-4 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        )}

        {/* Preview */}
        {selectedPath && (
          <div className="flex-1 min-w-0 overflow-y-auto bg-muted/20">
            {previewLoading ? (
              <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("thread.sessionInfo.files.loading")}
              </div>
            ) : previewUnsupported ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-[13px] text-muted-foreground px-4 text-center">
                <CircleAlert className="h-5 w-5 text-amber-500/70" />
                <div>
                  <p className="font-medium text-foreground/80">
                    {t("thread.sessionInfo.files.previewUnsupported", { defaultValue: "Preview not supported for this file type" })}
                  </p>
                  <p className="mt-1">
                    {t("thread.sessionInfo.files.previewUnsupportedHint", { defaultValue: "Please download to view the content." })}
                  </p>
                </div>
              </div>
            ) : previewError ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-[13px] text-destructive">
                <CircleAlert className="h-4 w-4" />
                <span>{t("thread.sessionInfo.files.error")}</span>
              </div>
            ) : preview ? (
              <div className="flex flex-col min-h-0 h-full p-3">
                <FilePreviewContent
                  language={preview.language}
                  content={preview.content}
                  viewMode={viewMode}
                  showLineNumbers
                  className="flex-1 min-h-0"
                />
                {preview.truncated && (
                  <div className="mt-2 text-[11px] text-muted-foreground shrink-0">
                    {t("filePreview.truncated")}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* No file selected placeholder */}
        {!selectedPath && (
          <div className="flex-1 min-w-0 overflow-y-auto bg-muted/20 flex justify-center pt-32">
            <span className="text-[13px] text-muted-foreground">
              {t("thread.sessionInfo.files.selectFile")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agents Tab                                                         */
/* ------------------------------------------------------------------ */

const AGENT_LIST_DEFAULT_WIDTH = 220;
const AGENT_LIST_MIN_WIDTH = 120;

function AgentsTab({
  subagentGroups,
  autoOpenSubagentTaskId,
  isTurnStreaming,
  cliApps,
  mcpPresets,
  onOpenFilePreview,
  onOpenLink,
}: {
  subagentGroups: SubagentGroup[];
  autoOpenSubagentTaskId?: string;
  isTurnStreaming: boolean;
  cliApps: CliAppInfo[];
  mcpPresets: McpPresetInfo[];
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}) {
  const { t } = useTranslation("common");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [listWidth, setListWidth] = useState(AGENT_LIST_DEFAULT_WIDTH);
  const listWidthRef = useRef(AGENT_LIST_DEFAULT_WIDTH);
  const lastAutoOpenRef = useRef<string | undefined>(undefined);

  // Auto-select on autoOpenSubagentTaskId change
  useEffect(() => {
    if (!autoOpenSubagentTaskId || autoOpenSubagentTaskId === lastAutoOpenRef.current) return;
    lastAutoOpenRef.current = autoOpenSubagentTaskId;
    setSelectedTaskId(autoOpenSubagentTaskId);
  }, [autoOpenSubagentTaskId]);

  // Auto-select first subagent if available and nothing selected
  useEffect(() => {
    if (subagentGroups.length > 0 && !selectedTaskId) {
      setSelectedTaskId(subagentGroups[0].taskId);
    }
  }, [subagentGroups, selectedTaskId]);

  // Keep listWidthRef in sync
  useEffect(() => {
    listWidthRef.current = listWidth;
  }, [listWidth]);

  const handleListResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const listEl = handle.previousElementSibling as HTMLElement | null;
    if (!listEl) return;
    const listRect = listEl.getBoundingClientRect();
    const leftEdge = listRect.left;
    const originalBodyCursor = document.body.style.cursor;
    const originalBodyUserSelect = document.body.style.userSelect;
    let nextWidth = listWidthRef.current;
    let frame: number | null = null;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyWidth = (clientX: number) => {
      nextWidth = Math.max(AGENT_LIST_MIN_WIDTH, clientX - leftEdge);
      listWidthRef.current = nextWidth;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setListWidth(nextWidth);
      });
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      applyWidth(moveEvent.clientX);
    };
    const handlePointerUp = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      setListWidth(nextWidth);
      document.body.style.cursor = originalBodyCursor;
      document.body.style.userSelect = originalBodyUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    applyWidth(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, []);

  const selectedGroup = subagentGroups.find((g) => g.taskId === selectedTaskId) ?? null;

  // Strip subagentTaskId/subagentTitle so the inner AgentActivityCluster renders
  // activity normally rather than re-grouping as nested subagent activity.
  const selectedMessages = useMemo(
    () =>
      selectedGroup?.messages.map((m) => {
        if (!m.subagentTaskId && !m.subagentTitle) return m;
        const { subagentTaskId: _, subagentTitle: __, ...rest } = m;
        return rest as typeof m;
      }) ?? [],
    [selectedGroup],
  );

  if (subagentGroups.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
        {t("thread.sessionInfo.agents.empty", { defaultValue: "No subagent activity in this session" })}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Subagent list */}
        <div
          className={cn(
            "overflow-y-auto border-r border-border/45 transition-[width] duration-200 ease-out",
            listCollapsed ? "w-0 border-r-0" : "",
          )}
          style={{ width: listCollapsed ? 0 : listWidth }}
        >
          <div className="py-1" style={{ minWidth: listWidth }}>
            {subagentGroups.map((group) => {
              const toolCount = group.messages.filter((m) => m.kind === "trace").length;
              const reasoningCount = group.messages.filter(
                (m) => m.role === "assistant" && m.kind !== "trace" && !m.content.trim(),
              ).length;
              const isSelected = group.taskId === selectedTaskId;

              return (
                <button
                  key={group.taskId}
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(group.taskId);
                    if (listCollapsed) setListCollapsed(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 transition-colors",
                    "hover:bg-accent/50",
                    isSelected && "bg-accent text-accent-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-violet-500/70" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium truncate">
                        {group.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground/60 mt-0.5">
                        {[
                          reasoningCount ? `${reasoningCount} thoughts` : "",
                          toolCount ? `${toolCount} calls` : "",
                        ]
                          .filter(Boolean)
                          .join(", ") || `${group.messages.length} events`}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* List resize handle */}
        {!listCollapsed && (
          <button
            type="button"
            aria-label={t("thread.sessionInfo.files.resizeTree", { defaultValue: "Resize list" })}
            className={cn(
              "group relative shrink-0 w-3 -ml-px cursor-col-resize touch-none",
              "flex items-center justify-center focus-visible:outline-none",
            )}
            onPointerDown={handleListResizeStart}
          >
            <span
              aria-hidden
              className={cn(
                "h-full w-px bg-foreground/25 opacity-0 transition-opacity",
                "group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100",
              )}
            />
            <GripVertical
              aria-hidden
              className="absolute h-4 w-4 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {selectedGroup ? (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setListCollapsed(!listCollapsed)}
                  aria-label={listCollapsed ? "Expand list" : "Collapse list"}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
                <Bot className="h-4 w-4 text-violet-500/70 shrink-0" />
                <span className="text-[13px] font-medium truncate">
                  {selectedGroup.title}
                </span>
              </div>
              <AgentActivityCluster
                messages={selectedMessages}
                isTurnStreaming={isTurnStreaming}
                hasBodyBelow={false}
                cliApps={cliApps}
                mcpPresets={mcpPresets}
                onOpenFilePreview={onOpenFilePreview}
                onOpenLink={onOpenLink}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full pt-32">
              <span className="text-[13px] text-muted-foreground">
                {t("thread.sessionInfo.agents.selectAgent", { defaultValue: "Select a subagent to view its activity" })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Automations Tab                                                    */
/* ------------------------------------------------------------------ */

function AutomationsTab({
  sessionKey,
  token,
  open,
}: {
  sessionKey: string;
  token: string;
  open: boolean;
}) {
  const { t } = useTranslation("common");
  const { jobs, loading, loadFailed, now } = useSessionAutomationJobs(open, token, sessionKey);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
          <span className="truncate text-[13px] font-medium text-foreground">
            {t("thread.sessionInfo.automations")}
          </span>
        </div>
        <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[11px] text-muted-foreground">
          {t("thread.sessionInfo.count", { count: jobs.length })}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-[16px] bg-muted/45 px-3 py-3 text-[12.5px] text-muted-foreground">
            <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
            {t("thread.sessionInfo.loading")}
          </div>
        ) : loadFailed ? (
          <div className="flex items-center gap-2 rounded-[16px] bg-destructive/10 px-3 py-3 text-[12.5px] text-destructive">
            <CircleAlert className="h-3.5 w-3.5" />
            {t("thread.sessionInfo.loadFailed")}
          </div>
        ) : jobs.length ? (
          <div className="space-y-1.5">
            {jobs.map((job) => (
              <AutomationRow key={job.id} job={job} now={now} />
            ))}
          </div>
        ) : (
          <div className="rounded-[16px] bg-muted/35 px-3 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {t("thread.sessionInfo.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
