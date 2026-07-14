import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { TFunction } from "i18next";
import {
  Brain,
  Check,
  CircleAlert,
  Code2,
  Copy,
  Download,
  Eye,
  GripVertical,
  KeyRound,
  Loader2,
  PanelRight,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { FilePreviewContent, isRenderableFile, type ViewMode } from "@/components/FilePreviewContent";
import { FileTreeNode } from "@/components/FileTree";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  downloadSkillZip,
  fetchSkillDetail,
  fetchSkillFilePreview,
  fetchSkillFiles,
  toggleSkill,
} from "@/lib/api";
import type { FilePreviewPayload, SkillDetail, SkillSummary, WorkspaceFileNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useClient } from "@/providers/ClientProvider";

export function SkillsCatalogSettings({ skills: initialSkills }: { skills: SkillSummary[] }) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillSummary[]>(initialSkills);
  const availableCount = skills.filter((skill) => skill.available && !skill.disabled).length;
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);

  useEffect(() => {
    setSkills(initialSkills);
  }, [initialSkills]);

  return (
    <div className="space-y-7">
      <section className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-[680px] text-[13px] leading-5 text-muted-foreground">
          {t("settings.skills.description", {
            defaultValue: "Review the instruction skills this agent can load during a conversation.",
          })}
        </p>
        <span className="text-[12px] font-medium text-muted-foreground">
          {t("settings.skills.caption", {
            available: availableCount,
            total: skills.length,
            defaultValue: "{{available}} available · {{total}} total",
          })}
        </span>
      </section>

      <section>
        <div className="flex items-center justify-between border-b border-border/45 pb-3">
          <h2 className="mb-2 px-1 text-[13px] font-semibold tracking-[-0.01em] text-foreground/85">
            {t("settings.skills.featured", { defaultValue: "Agent skills" })}
          </h2>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
            {skills.length}
          </span>
        </div>
        {skills.length ? (
          <div className="grid gap-x-10 gap-y-1 py-3 md:grid-cols-2">
            {skills.map((skill) => (
              <SkillCatalogRow
                key={`${skill.source}:${skill.name}`}
                skill={skill}
                onSelect={setSelectedSkill}
              />
            ))}
          </div>
        ) : (
          <div className="px-3 py-12 text-center text-sm text-muted-foreground">
            {t("settings.skills.empty", { defaultValue: "No skills are available." })}
          </div>
        )}
      </section>

      <SkillDetailSheet
        skill={selectedSkill}
        open={selectedSkill !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null);
        }}
        onSkillsUpdate={(updatedSkills) => {
          setSkills(updatedSkills);
          const refreshed = updatedSkills.find((s) => s.name === selectedSkill?.name);
          if (refreshed) setSelectedSkill(refreshed);
        }}
      />
    </div>
  );
}

function SkillCatalogRow({
  skill,
  onSelect,
}: {
  skill: SkillSummary;
  onSelect: (skill: SkillSummary) => void;
}) {
  const { t } = useTranslation();
  const sourceLabel = skillSourceLabel(skill.source, t);
  const StatusIcon = skill.available ? Check : CircleAlert;
  const isDisabled = skill.source === "workspace" && skill.disabled;
  const statusLabel = isDisabled
    ? t("settings.skills.statusDisabled", { defaultValue: "Disabled" })
    : skill.available
      ? t("settings.skills.statusAvailable", { defaultValue: "Available" })
      : t("settings.skills.statusUnavailable", { defaultValue: "Unavailable" });

  return (
    <button
      type="button"
      aria-label={t("settings.skills.openDetails", {
        name: skill.name,
        defaultValue: "Open details for {{name}}",
      })}
      onClick={() => onSelect(skill)}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-colors",
        "hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !skill.available && !isDisabled && "opacity-65",
        isDisabled && "opacity-50",
      )}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-muted/70 text-muted-foreground">
        <Brain className="h-5 w-5" strokeWidth={1.8} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-foreground">
            {skill.name}
          </h3>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
            {sourceLabel}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
          {skill.description}
        </p>
        {!skill.available && skill.unavailable_reason && !isDisabled ? (
          <p className="mt-1 truncate text-[12px] leading-4 text-muted-foreground/80">
            {t("settings.skills.unavailableReason", {
              reason: skill.unavailable_reason,
              defaultValue: "Missing: {{reason}}",
            })}
          </p>
        ) : null}
      </div>
      <span
        title={!skill.available && skill.unavailable_reason ? skill.unavailable_reason : undefined}
        className={cn(
          "hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium sm:inline-flex",
          isDisabled
            ? "bg-muted text-muted-foreground"
            : skill.available
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
        )}
      >
        {isDisabled ? null : <StatusIcon className="h-3.5 w-3.5" aria-hidden />}
        {statusLabel}
      </span>
    </button>
  );
}

function SkillDetailSheet({
  skill,
  open,
  onOpenChange,
  onSkillsUpdate,
}: {
  skill: SkillSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSkillsUpdate: (skills: SkillSummary[]) => void;
}) {
  const { token } = useClient();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [sheetWidth, setSheetWidth] = useState(544);
  const [entered, setEntered] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "browse">("info");
  const sheetWidthRef = useRef(544);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    sheetWidthRef.current = sheetWidth;
  }, [sheetWidth]);

  const handleSheetResize = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const startX = e.clientX;
    const startWidth = sheetWidthRef.current;
    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const next = Math.max(0, startWidth + delta);
      sheetWidthRef.current = next;
      setSheetWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (sheetWidthRef.current < 200) {
        onOpenChange(false);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    e.preventDefault();
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || !skill) return;
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    setLoadFailed(false);
    setToggleError(null);
    fetchSkillDetail(token, skill.name)
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, skill, token]);

  if (!skill) return null;

  const activeSkill = detail ?? skill;
  const sourceLabel = skillSourceLabel(activeSkill.source, t);
  const isWorkspace = activeSkill.source === "workspace";
  const isDisabled = activeSkill.disabled ?? false;
  const statusLabel = isWorkspace && isDisabled
    ? t("settings.skills.statusDisabled", { defaultValue: "Disabled" })
    : activeSkill.available
      ? t("settings.skills.statusAvailable", { defaultValue: "Available" })
      : t("settings.skills.statusUnavailable", { defaultValue: "Unavailable" });

  const handleToggle = async () => {
    setToggling(true);
    setToggleError(null);
    try {
      const payload = await toggleSkill(token, skill.name, isDisabled);
      const updatedSkills = payload.skills;
      onSkillsUpdate(updatedSkills);
      const updatedSkill = updatedSkills.find((s) => s.name === skill.name);
      if (updatedSkill) {
        setDetail((prev) => prev ? { ...prev, disabled: updatedSkill.disabled } : prev);
      }
    } catch (err) {
      setToggleError(
        err instanceof Error ? err.message : t("settings.skills.toggleFailed", { defaultValue: "Failed to toggle skill." }),
      );
    } finally {
      setToggling(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        style={{
          "--sheet-width": `${sheetWidth}px`,
          "--sheet-slot-width": !entered ? "0px" : `${sheetWidth}px`,
          width: `min(calc(100vw - 1rem), var(--sheet-slot-width))`,
        } as CSSProperties}
      >
        <button
          type="button"
          aria-label={t("settings.skills.sheetResize", { defaultValue: "Resize panel" })}
          className={cn(
            "group absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none md:flex",
            "items-stretch justify-center focus-visible:outline-none",
          )}
          onPointerDown={handleSheetResize}
        >
          <span
            aria-hidden
            className={cn(
              "h-full w-px bg-foreground/25 opacity-0 transition-opacity",
              "group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100",
            )}
          />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 flex flex-col">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] bg-muted/70 text-muted-foreground">
              <Brain className="h-5 w-5" strokeWidth={1.8} aria-hidden />
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate text-[20px] font-semibold">
                {activeSkill.name}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t("settings.skills.detailDescription", {
                  name: activeSkill.name,
                  defaultValue: "Details for {{name}}.",
                })}
              </SheetDescription>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                <Pill>{sourceLabel}</Pill>
                <Pill tone={isWorkspace && isDisabled ? "muted" : activeSkill.available ? "success" : "muted"}>{statusLabel}</Pill>
                {isWorkspace ? (
                  <span className="inline-flex items-center gap-1.5 ml-1">
                    {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
                    <span className="scale-75 origin-left">
                      <Switch
                        checked={!isDisabled}
                        onCheckedChange={handleToggle}
                        disabled={toggling}
                      />
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {toggleError ? (
            <div className="mt-3 rounded-[12px] bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {toggleError}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("settings.skills.loadingDetail", { defaultValue: "Loading skill details..." })}
            </div>
          ) : loadFailed ? (
            <div className="mt-8 rounded-[16px] bg-destructive/10 px-3 py-3 text-sm text-destructive">
              {t("settings.skills.loadFailed", { defaultValue: "Could not load skill details." })}
            </div>
          ) : (
            <div className="mt-5 flex flex-col min-h-0 flex-1 gap-4">
              {/* Tabs */}
              <div className="flex items-center gap-0.5 rounded-[12px] bg-muted/40 p-0.5 w-fit">
                <button
                  type="button"
                  onClick={() => setActiveTab("info")}
                  className={cn(
                    "rounded-[10px] px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    activeTab === "info"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("settings.skills.basicInfo", { defaultValue: "Basic Info" })}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("browse")}
                  className={cn(
                    "rounded-[10px] px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    activeTab === "browse"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("settings.skills.skillBrowse", { defaultValue: "Browse Skill" })}
                </button>
              </div>

              {activeTab === "info" ? (
                <div className="flex flex-col gap-6">
                  <DetailSection title={t("settings.skills.descriptionTitle", { defaultValue: "Description" })}>
                    <p className="text-[14px] leading-6 text-muted-foreground">{activeSkill.description}</p>
                  </DetailSection>

                  <div className="grid grid-cols-2 gap-2">
                    <MetaItem
                      label={t("settings.skills.source", { defaultValue: "Source" })}
                      value={sourceLabel}
                    />
                    <MetaItem
                      label={t("settings.skills.status", { defaultValue: "Status" })}
                      value={statusLabel}
                    />
                    {activeSkill.path ? (
                      <div className="col-span-2 rounded-[16px] bg-muted/35 px-3 py-2.5">
                        <div className="text-[11px] text-muted-foreground">
                          {t("settings.skills.path", { defaultValue: "Path" })}
                        </div>
                        <div className="mt-0.5 break-all text-[12px] font-mono text-foreground/80">
                          {activeSkill.path}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {!activeSkill.available && activeSkill.unavailable_reason && !(isWorkspace && isDisabled) ? (
                    <DetailSection
                      title={t("settings.skills.unavailableReasonLabel", {
                        defaultValue: "Unavailable reason",
                      })}
                    >
                      <p className="text-[13px] leading-5 text-destructive/85">
                        {activeSkill.unavailable_reason}
                      </p>
                    </DetailSection>
                  ) : null}

                  {detail ? <RequirementsSection detail={detail} /> : null}
                </div>
              ) : (
                <div className="flex flex-col min-h-0 flex-1">
                  {detail ? <SkillFilesPanel skillName={skill.name} token={token} /> : null}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SkillFilesPanel({ skillName, token }: { skillName: string; token: string }) {
  const { t } = useTranslation();
  const [tree, setTree] = useState<WorkspaceFileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewUnsupported, setPreviewUnsupported] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [copied, setCopied] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeWidth, setTreeWidth] = useState(220);
  const treeResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const autoSelectRef = useRef(false);

  const loadTree = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchSkillFiles(token, skillName)
      .then((payload) => {
        if (!cancelled) {
          setTree(payload.tree);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [token, skillName]);

  useEffect(() => {
    if (!skillName) return;
    const cancel = loadTree();
    return cancel;
  }, [loadTree, skillName]);

  useEffect(() => {
    if (!tree || autoSelectRef.current) return;
    const findSkilMd = (node: WorkspaceFileNode): string | null => {
      if (node.type === "file" && node.name === "SKILL.md") return node.path;
      if (node.children) {
        for (const child of node.children) {
          const found = findSkilMd(child);
          if (found) return found;
        }
      }
      return null;
    };
    const skilPath = findSkilMd(tree);
    if (skilPath) {
      autoSelectRef.current = true;
      setSelectedPath(skilPath);
    }
  }, [tree]);

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
        const payload = await fetchSkillFilePreview(token, skillName, selectedPath);
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
  }, [selectedPath, token, skillName]);

  const selectFile = useCallback((path: string) => {
    setSelectedPath(path);
    if (treeCollapsed) setTreeCollapsed(false);
  }, [treeCollapsed]);

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

  const handleTreeResizeStart = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const startX = e.clientX;
    const startWidth = treeWidth;
    treeResizeRef.current = { startX, startWidth };
    const onMove = (ev: PointerEvent) => {
      if (!treeResizeRef.current) return;
      const delta = ev.clientX - treeResizeRef.current.startX;
      const next = Math.max(140, Math.min(480, treeResizeRef.current.startWidth + delta));
      setTreeWidth(next);
    };
    const onUp = () => {
      treeResizeRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    e.preventDefault();
  }, [treeWidth]);

  const treeChildren = tree?.children;

  return (
    <DetailSection
      title={t("settings.skills.files", { defaultValue: "Files" })}
      className="flex flex-col min-h-0 flex-1"
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            downloadSkillZip(token, skillName).catch(() => {});
          }}
          aria-label={t("settings.skills.fileDownloadZip", { defaultValue: "Download skill as ZIP" })}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="rounded-[16px] border border-border/45 overflow-hidden flex flex-col flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            {t("settings.skills.fileLoading", { defaultValue: "Loading files..." })}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[13px] text-destructive">
            <CircleAlert className="h-4 w-4" />
            <span>{t("settings.skills.fileError", { defaultValue: "Could not load files." })}</span>
            <Button variant="ghost" size="sm" onClick={loadTree} className="text-[12px]">
              {t("settings.skills.fileRetry", { defaultValue: "Retry" })}
            </Button>
          </div>
        ) : !treeChildren || treeChildren.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
            {t("settings.skills.fileEmpty", { defaultValue: "No files." })}
          </div>
        ) : (
          <>
            {/* Toolbar */}
            {selectedPath && (
              <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border/45 bg-muted/30">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setTreeCollapsed(!treeCollapsed)}
                  aria-label={treeCollapsed
                    ? t("settings.skills.fileExpandTree", { defaultValue: "Expand file tree" })
                    : t("settings.skills.fileCollapseTree", { defaultValue: "Collapse file tree" })
                  }
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
                <span className="flex-1 truncate text-[12px] text-muted-foreground px-2">
                  {selectedPath.split("/").pop()}
                </span>
                {preview && isRenderableFile(preview.language) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setViewMode(viewMode === "preview" ? "source" : "preview")}
                    aria-label={viewMode === "preview"
                      ? t("settings.skills.fileViewSource", { defaultValue: "View source" })
                      : t("settings.skills.fileViewPreview", { defaultValue: "View preview" })
                    }
                  >
                    {viewMode === "preview" ? (
                      <Code2 className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
                {preview && isRenderableFile(preview.language) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={handleCopy}
                    aria-label={t("settings.skills.fileCopy", { defaultValue: "Copy content" })}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 min-h-0 flex">
              {/* Tree */}
              <div
                className={cn(
                  "overflow-y-auto overflow-x-hidden border-r border-border/45 transition-[width] duration-200 ease-out",
                  treeCollapsed ? "w-0 border-r-0" : "",
                )}
                style={{ width: treeCollapsed ? 0 : treeWidth }}
              >
                <div className="py-2">
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
                  aria-label={t("settings.skills.fileResizeTree", { defaultValue: "Resize file tree" })}
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
              <div className="flex-1 min-w-0 overflow-y-auto bg-muted/20">
                {!selectedPath ? (
                  <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground px-4 text-center">
                    {t("settings.skills.fileSelectPrompt", { defaultValue: "Select a file to preview" })}
                  </div>
                ) : previewLoading ? (
                  <div className="flex items-center justify-center h-full text-[13px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t("settings.skills.filePreviewLoading", { defaultValue: "Loading..." })}
                  </div>
                ) : previewUnsupported ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-[13px] text-muted-foreground px-4 text-center">
                    <CircleAlert className="h-5 w-5 text-amber-500/70" />
                    <div>
                      <p className="font-medium text-foreground/80">
                        {t("settings.skills.filePreviewUnsupported", { defaultValue: "Preview not supported for this file type" })}
                      </p>
                      <p className="mt-1">
                        {t("settings.skills.filePreviewUnsupportedHint", { defaultValue: "Please download to view the content." })}
                      </p>
                    </div>
                  </div>
                ) : previewError ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-[13px] text-destructive">
                    <CircleAlert className="h-4 w-4" />
                    <span>{t("settings.skills.filePreviewError", { defaultValue: "Could not load preview." })}</span>
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
            </div>
          </>
        )}
      </div>
    </DetailSection>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] bg-muted/35 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value}</div>
    </div>
  );
}

function RequirementsSection({ detail }: { detail: SkillDetail }) {
  const { t } = useTranslation();
  const { bins, env, missing_bins, missing_env } = detail.requirements;
  const hasRequirements = bins.length > 0 || env.length > 0;

  return (
    <DetailSection title={t("settings.skills.requirements", { defaultValue: "Requirements" })}>
      {hasRequirements ? (
        <div className="space-y-3">
          {missing_bins.length ? (
            <RequirementLine
              title={t("settings.skills.missingCommands", { defaultValue: "Missing CLI" })}
              items={missing_bins}
              tone="danger"
              icon={<Terminal className="h-3.5 w-3.5" aria-hidden />}
            />
          ) : null}
          {missing_env.length ? (
            <RequirementLine
              title={t("settings.skills.missingEnvironment", { defaultValue: "Missing ENV" })}
              items={missing_env}
              tone="danger"
              icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />}
            />
          ) : null}
          {bins.length ? (
            <RequirementLine
              title={t("settings.skills.commands", { defaultValue: "Commands" })}
              items={bins}
              icon={<Terminal className="h-3.5 w-3.5" aria-hidden />}
            />
          ) : null}
          {env.length ? (
            <RequirementLine
              title={t("settings.skills.environment", { defaultValue: "Environment variables" })}
              items={env}
              icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />}
            />
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {t("settings.skills.noRequirements", { defaultValue: "No explicit requirements." })}
        </p>
      )}
    </DetailSection>
  );
}

function DetailSection({ title, children, className, actions }: { title: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[12px] font-medium text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function RequirementLine({
  title,
  items,
  icon,
  tone = "muted",
}: {
  title: string;
  items: string[];
  icon: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "flex items-center gap-1.5 text-[12px]",
          tone === "danger" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Pill key={item}>{item}</Pill>
        ))}
      </div>
    </div>
  );
}

function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "success";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "success"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function skillSourceLabel(source: string, t: TFunction): string {
  if (source === "workspace") {
    return t("settings.skills.sourceWorkspace", { defaultValue: "Custom" });
  }
  if (source === "builtin") {
    return t("settings.skills.sourceBuiltin", { defaultValue: "Built-in" });
  }
  return source;
}
