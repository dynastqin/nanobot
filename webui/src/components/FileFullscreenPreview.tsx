import { useCallback, useEffect, useState } from "react";
import { Code2, Copy, Download, Eye, Loader2, Minimize2, CircleAlert, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ArtifactShareButton } from "@/components/ArtifactShareButton";
import { Button } from "@/components/ui/button";
import { FilePreviewContent, isRenderableFile, type ViewMode } from "@/components/FilePreviewContent";
import { ApiError, fetchFilePreview, type ArtifactShareResult } from "@/lib/api";
import type { FilePreviewPayload } from "@/lib/types";

interface FileFullscreenPreviewProps {
  sessionKey: string;
  token: string;
  path: string;
  onClose: () => void;
  initialShare?: ArtifactShareResult | null;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: FilePreviewPayload };

export function FileFullscreenPreview({
  sessionKey,
  token,
  path,
  onClose,
  initialShare,
}: FileFullscreenPreviewProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setViewMode("preview");
    fetchFilePreview(token, sessionKey, path)
      .then((payload) => {
        if (!cancelled) setState({ status: "ready", payload });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : t("filePreview.failed");
        setState({ status: "error", message });
      });
    return () => { cancelled = true; };
  }, [path, sessionKey, t, token]);

  const handleCopy = useCallback(async () => {
    if (state.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.payload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [state]);

  const handleDownload = useCallback(() => {
    if (state.status !== "ready") return;
    const blob = new Blob([state.payload.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name = path.split("/").pop() || "file";
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [path, state]);

  const displayPath = state.status === "ready" ? state.payload.display_path : path;
  const displayFullPath = "/" + displayPath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayPath);
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [displayPath]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background animate-in fade-in-0 duration-200">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 h-12">
        {/* Breadcrumbs */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            className="min-w-0 truncate text-[13px] text-muted-foreground/70 hover:text-foreground cursor-pointer"
            title={displayFullPath}
            onClick={handleCopyPath}
          >
            {displayFullPath}
          </button>
          {pathCopied && (
            <span className="shrink-0 text-[11px] text-emerald-500 animate-in fade-in-0">
              ✓ {t("filePreview.pathCopied", { defaultValue: "copied" })}
            </span>
          )}
        </div>

        {/* Actions */}
        {state.status === "ready" && isRenderableFile(state.payload.language) && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode(viewMode === "preview" ? "source" : "preview")}
            aria-label={viewMode === "preview" ? t("filePreview.viewSource") : t("filePreview.viewPreview")}
          >
            {viewMode === "preview" ? (
              <Code2 className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleCopy}
          disabled={state.status !== "ready"}
          aria-label={t("thread.sessionInfo.files.copyContent")}
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleDownload}
          disabled={state.status !== "ready"}
          aria-label={t("thread.sessionInfo.files.download")}
        >
          <Download className="h-4 w-4" />
        </Button>
        {path.includes("outputs/") && (
          <ArtifactShareButton
            key={path}
            token={token}
            sessionKey={sessionKey}
            filePath={path}
            initialShare={initialShare ?? null}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label={t("filePreview.restore", { defaultValue: "Restore" })}
        >
          <Minimize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {state.status === "loading" ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("filePreview.loading")}
          </div>
        ) : state.status === "error" ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            <div className="max-w-sm">
              <CircleAlert className="mx-auto mb-3 h-5 w-5 text-muted-foreground/70" />
              <p>{state.message}</p>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {state.payload.truncated ? (
              <div className="mx-4 mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200 shrink-0">
                {t("filePreview.truncated")}
              </div>
            ) : null}
            <FilePreviewContent
              language={state.payload.language}
              content={state.payload.content}
              viewMode={viewMode}
              showLineNumbers
              wrapLongLines={false}
              className="flex-1 min-h-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}
