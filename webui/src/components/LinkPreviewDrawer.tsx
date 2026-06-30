import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

interface LinkPreviewDrawerProps {
  url: string;
  desktopWidth?: number;
  isClosing?: boolean;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClose: () => void;
}

export function LinkPreviewDrawer({
  url,
  desktopWidth = 544,
  isClosing = false,
  onResizeStart,
  onClose,
}: LinkPreviewDrawerProps) {
  const { t } = useTranslation();
  const [entered, setEntered] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
  }, [url]);

  const handleIframeLoad = useCallback(() => {
    setIframeLoading(false);
    setIframeError(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setIframeLoading(false);
    setIframeError(true);
  }, []);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [url]);

  const handleOpenExternal = useCallback(() => {
    window.open(url, "_blank", "noreferrer,noopener");
  }, [url]);

  return (
    <aside
      aria-label={t("linkPreview.aria", { defaultValue: "Link preview" })}
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
            aria-label={t("filePreview.resize", { defaultValue: "Resize link preview" })}
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
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label={t("linkPreview.close", { defaultValue: "Close link preview" })}
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium" title={url}>
                {url}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={handleCopyUrl}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full",
                  "text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
                )}
                aria-label={t("linkPreview.copyUrl", { defaultValue: "Copy URL" })}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={handleOpenExternal}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full",
                  "text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
                )}
                aria-label={t("linkPreview.openExternal", { defaultValue: "Open in new window" })}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col">
            {iframeLoading && !iframeError ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("linkPreview.loading", { defaultValue: "Loading page..." })}
              </div>
            ) : null}
            {iframeError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-muted-foreground">
                <p>{t("linkPreview.failed", { defaultValue: "Could not load this page." })}</p>
                <button
                  type="button"
                  onClick={() => {
                    setIframeLoading(true);
                    setIframeError(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                    "bg-muted/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Loader2 className="h-3 w-3" aria-hidden />
                  {t("linkPreview.retry", { defaultValue: "Retry" })}
                </button>
              </div>
            ) : null}
            <iframe
              src={url}
              title={url}
              className={cn(
                "min-h-0 flex-1 border-0",
                (iframeLoading || iframeError) && "hidden",
              )}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
