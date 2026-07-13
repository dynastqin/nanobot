import { useState, useCallback, useRef, useEffect } from "react";
import { Check, Copy, Loader2, Share2, RefreshCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { copyTextToClipboard } from "@/lib/clipboard";
import { ApiError, createArtifactShare, type ArtifactShareResult } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ArtifactShareButtonProps {
  token: string;
  sessionKey: string;
  filePath: string;
  className?: string;
  variant?: "icon" | "icon-sm";
  /** Share info already loaded from the workspace-files tree node. */
  initialShare?: ArtifactShareResult | null;
}

const EXPIRY_OPTIONS = [
  { labelKey: "artifact.permanent", value: 0 },
  { labelKey: "artifact.1d", value: 86400 },
  { labelKey: "artifact.7d", value: 604800 },
] as const;

function formatExpiryText(
  expiresAt: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (expiresAt === 0) return t("artifact.permanent");
  const d = new Date(expiresAt * 1000);
  return t("artifact.expiresAt", { date: d.toLocaleString() });
}

function isExpired(expiresAt: number): boolean {
  return expiresAt > 0 && expiresAt * 1000 < Date.now();
}

const popoverClassName = cn(
  "z-50 min-w-[280px] max-w-[360px] rounded-[18px] border border-border/65",
  "bg-popover/96 p-3 backdrop-blur-xl",
  "shadow-[0_18px_55px_rgba(15,23,42,0.18)]",
  "dark:border-white/10 dark:shadow-[0_22px_55px_rgba(0,0,0,0.45)]",
);

export function ArtifactShareButton({
  token,
  sessionKey,
  filePath,
  className,
  variant = "icon",
  initialShare,
}: ArtifactShareButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [expiresIn, setExpiresIn] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArtifactShareResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const prevKeyRef = useRef(sessionKey);

  const effectiveShare: ArtifactShareResult | null =
    initialShare && initialShare.url
      ? { ...initialShare, url: `${window.location.origin}${initialShare.url}` }
      : null;

  // Reset on session change
  useEffect(() => {
    if (prevKeyRef.current !== sessionKey) {
      prevKeyRef.current = sessionKey;
      setResult(null);
      setError(null);
      setCopied(false);
      setRegenerating(false);
    }
  }, [sessionKey]);

  // Reset on filePath change
  useEffect(() => {
    setResult(null);
    setError(null);
    setCopied(false);
    setRegenerating(false);
  }, [filePath]);

  // Show initialShare on open (skip when user is regenerating)
  useEffect(() => {
    if (effectiveShare && !result && !regenerating) {
      setResult(effectiveShare);
    }
  }, [effectiveShare, result, regenerating]);

  // Click outside to dismiss
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (prev) {
        // closing — reset regenerating on next open
        setRegenerating(false);
      }
      return !prev;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await createArtifactShare(token, sessionKey, filePath, expiresIn);
      setResult({
        url: `${window.location.origin}${res.url}`,
        expires_at: res.expires_at,
        expires_in: res.expires_in,
        filename: res.filename,
      });
      setRegenerating(false);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [token, sessionKey, filePath, expiresIn]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    const ok = await copyTextToClipboard(result.url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const handleRegenerate = useCallback(() => {
    setResult(null);
    setError(null);
    setRegenerating(true);
  }, []);

  const iconSize = variant === "icon-sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const btnSize = variant === "icon-sm" ? "h-7 w-7" : "h-8 w-8";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex items-center justify-center rounded-full transition-colors hover:bg-muted",
          btnSize,
          className,
        )}
        onClick={handleToggle}
        aria-label={t("artifact.share")}
      >
        <Share2 className={iconSize} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={cn(popoverClassName, "absolute right-0 top-full mt-2")}
        >
          {!result ? (
            <div className="flex flex-col gap-2.5">
              <div className="text-[12px] font-semibold text-muted-foreground px-0.5">
                {t("artifact.shareTitle")}
              </div>

              <div className="flex rounded-[12px] bg-muted/70 p-0.5">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setExpiresIn(opt.value)}
                    className={cn(
                      "flex-1 rounded-[10px] px-2 py-1 text-[12px] font-medium transition-colors",
                      expiresIn === opt.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>

              {error && (
                <p className="text-[12px] text-destructive">{error}</p>
              )}

              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-[12px] py-1.5 text-[13px] font-medium",
                  "bg-foreground text-background transition-opacity hover:opacity-90",
                  "disabled:opacity-50",
                )}
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("artifact.generateLink")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-muted-foreground">
                  {t("artifact.urlLabel")}
                </span>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <RefreshCcw className="h-3 w-3" />
                  {t("artifact.regenerate")}
                </button>
              </div>

              <div className="flex items-center gap-1.5 rounded-[12px] bg-muted/60 px-2.5 py-1.5">
                <code className="flex-1 truncate text-[12px] leading-relaxed">
                  {result.url}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className={cn(
                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
                    copied ? "text-emerald-500" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  aria-label={t("artifact.copyLink")}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <p className="text-[12px] text-muted-foreground">
                {formatExpiryText(result.expires_at, t)}
                {isExpired(result.expires_at) && (
                  <span className="ml-1 text-destructive">{t("artifact.expired")}</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
