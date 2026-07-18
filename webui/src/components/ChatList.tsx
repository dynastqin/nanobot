import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deriveTitle, relativeTime } from "@/lib/format";
import {
  COLLAPSED_CHATS_VISIBLE_COUNT,
  displayTitle,
  groupSessions,
  isCollapsedProject,
  isFoldableChatsGroup,
  isFoldedChatsGroup,
  limitGroups,
  visibleSessionsForGroup,
  type ChatGroupLabels,
  type SessionGroup,
} from "@/lib/chat-groups";
import { cn } from "@/lib/utils";
import type { ChatSummary, SidebarDensity, SidebarSortMode } from "@/lib/types";

const INITIAL_VISIBLE_SESSIONS = 160;
const VISIBLE_SESSIONS_INCREMENT = 160;
const ACTION_MENU_CONTENT_CLASS = "w-[8.5rem] min-w-[8.5rem]";
const ACTION_MENU_ITEM_CLASS = "grid w-[7.75rem] grid-cols-[1rem_minmax(0,1fr)] items-center gap-2";
const ACTION_MENU_SUB_TRIGGER_CLASS = "flex w-[8.5rem] items-center gap-2 whitespace-nowrap";

interface ChatListProps {
  sessions: ChatSummary[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onRequestDelete: (key: string, label: string) => void;
  onTogglePin: (key: string) => void;
  onRequestRename: (key: string, label: string) => void;
  onToggleArchive: (key: string) => void;
  onToggleGroup?: (groupId: string) => void;
  onRequestRenameProject?: (projectKey: string, label: string) => void;
  onNewChatInProject?: (projectPath: string, projectName: string) => void;
  pinnedKeys?: string[];
  archivedKeys?: string[];
  titleOverrides?: Record<string, string>;
  projectNameOverrides?: Record<string, string>;
  collapsedGroups?: Record<string, boolean>;
  runningChatIds?: string[];
  updatedChatIds?: string[];
  density?: SidebarDensity;
  showPreviews?: boolean;
  showTimestamps?: boolean;
  sort?: SidebarSortMode;
  showArchived?: boolean;
  defaultWorkspacePath?: string | null;
  actionMenuPortalContainer?: HTMLElement | null;
  loading?: boolean;
  emptyLabel?: string;
  folders?: Array<{ id: string; name: string; order: number }>;
  sessionFolder?: Record<string, string>;
  onRenameFolder?: (folderId: string, newName: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onMoveToFolder?: (sessionKey: string, folderId: string | null) => void;
  onCreateFolder?: (name: string) => Promise<string | null>;
  onRename?: (key: string, newName: string) => void;
  onDelete?: (key: string) => void;
}

export const ChatList = memo(function ChatList({
  sessions,
  activeKey,
  onSelect,
  onRequestDelete,
  onTogglePin,
  onRequestRename,
  onToggleArchive,
  onToggleGroup,
  onRequestRenameProject,
  onNewChatInProject,
  pinnedKeys = [],
  archivedKeys = [],
  titleOverrides = {},
  projectNameOverrides = {},
  collapsedGroups = {},
  runningChatIds = [],
  updatedChatIds = [],
  density = "comfortable",
  showPreviews = false,
  showTimestamps = false,
  sort = "updated_desc",
  showArchived = false,
  defaultWorkspacePath,
  actionMenuPortalContainer,
  loading,
  emptyLabel,
  folders = [],
  sessionFolder = {},
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onCreateFolder,
  onRename,
  onDelete,
}: ChatListProps) {
  const { t } = useTranslation();
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_SESSIONS);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deletePopoverPos, setDeletePopoverPos] = useState<{ top: number; left: number } | null>(null);
  const deleteTriggerRef = useRef<Map<string, HTMLElement>>(new Map());
  const hasInlineRename = Boolean(onRename);
  const hasInlineDelete = Boolean(onDelete);
  const labels = useMemo<ChatGroupLabels>(() => ({
    pinned: t("chat.groups.pinned"),
    all: t("chat.groups.all"),
    today: t("chat.groups.today"),
    yesterday: t("chat.groups.yesterday"),
    earlier: t("chat.groups.earlier"),
    archived: t("chat.groups.archived"),
    projects: t("chat.groups.projects"),
    fallbackTitle: t("chat.newChat"),
  }), [t]);
  const groups = useMemo(
    () => groupSessions(sessions, labels, {
      pinnedKeys,
      archivedKeys,
      titleOverrides,
      projectNameOverrides,
      showArchived,
      sort,
      defaultWorkspacePath,
      folders,
      sessionFolder,
    }),
    [
      archivedKeys,
      labels,
      pinnedKeys,
      sessions,
      showArchived,
      sort,
      titleOverrides,
      projectNameOverrides,
      defaultWorkspacePath,
      folders,
      sessionFolder,
    ],
  );
  const limitedGroups = useMemo(
    () => limitGroups(groups, visibleLimit, activeKey, collapsedGroups),
    [activeKey, collapsedGroups, groups, visibleLimit],
  );
  const totalSessionCount = useMemo(
    () => groups.reduce(
      (total, group) =>
        total + (isCollapsedProject(group, collapsedGroups) ? 0 : group.sessions.length),
      0,
    ),
    [collapsedGroups, groups],
  );
  const visibleSessionCount = useMemo(
    () => limitedGroups.reduce((total, group) => total + group.sessions.length, 0),
    [limitedGroups],
  );
  const hiddenSessionCount = Math.max(0, totalSessionCount - visibleSessionCount);

  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE_SESSIONS);
  }, [showArchived, sort]);

  const startRename = useCallback((key: string, title: string) => {
    setRenameValue(title);
    setRenamingKey(key);
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, []);

  const confirmRename = useCallback(() => {
    const trimmed = renameValue.trim();
    const key = renamingKey;
    if (key && trimmed) {
      onRename?.(key, trimmed);
    }
    setRenamingKey(null);
  }, [renameValue, renamingKey, onRename]);

  const cancelRename = useCallback(() => {
    setRenamingKey(null);
  }, []);

  const openDeleteConfirm = useCallback((key: string, label: string) => {
    const el = deleteTriggerRef.current.get(key);
    if (!el) {
      onRequestDelete(key, label);
      return;
    }
    const rect = el.getBoundingClientRect();
    setDeletePopoverPos({
      top: rect.bottom + 4,
      left: rect.right - 208,
    });
    setDeletingKey(key);
  }, [onRequestDelete]);

  const closeDeleteConfirm = useCallback(() => {
    setDeletingKey(null);
    setDeletePopoverPos(null);
  }, []);

  const handleDelete = useCallback(() => {
    const key = deletingKey;
    if (key) {
      onDelete?.(key);
    }
    closeDeleteConfirm();
  }, [deletingKey, onDelete, closeDeleteConfirm]);

  useEffect(() => {
    if (!deletingKey) return;
    const timer = window.setTimeout(closeDeleteConfirm, 4000);
    return () => window.clearTimeout(timer);
  }, [deletingKey, closeDeleteConfirm]);

  useEffect(() => {
    if (!deletingKey) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDeleteConfirm();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleDelete();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [deletingKey, handleDelete, closeDeleteConfirm]);

  if (loading && sessions.length === 0) {
    return (
      <div className="px-3 py-6 text-[12px] text-muted-foreground">
        {t("chat.loading")}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-6 text-[12px] leading-5 text-muted-foreground/80">
        {emptyLabel ?? t("chat.noSessions")}
      </div>
    );
  }

  const pinned = new Set(pinnedKeys);
  const archived = new Set(archivedKeys);
  const running = new Set(runningChatIds);
  const updated = new Set(updatedChatIds);
  const compact = density === "compact";
  const firstProjectGroupIndex = limitedGroups.findIndex((group) => group.kind === "project");

  function renderSessionRow(s: ChatSummary, group: SessionGroup) {
    const active = s.key === activeKey;
    const fallbackTitle = t("chat.fallbackTitle", {
      id: s.chatId.slice(0, 6),
    });
    const generatedTitle = s.title?.trim() || "";
    const title = displayTitle(s, titleOverrides, t("chat.newChat"));
    const tooltipTitle =
      titleOverrides[s.key]?.trim() ||
      generatedTitle ||
      deriveTitle(s.preview, fallbackTitle);
    const isPinned = pinned.has(s.key);
    const isArchived = archived.has(s.key);
    const preview = s.preview.trim();
    const showPreview = showPreviews && preview && preview !== title;
    const timestamp = showTimestamps
      ? relativeTime(s.updatedAt ?? s.createdAt)
      : "";
    const projectMode = group.kind === "project";
    const folderMode = group.kind === "folder";
    const activityState = running.has(s.chatId)
      ? "running"
      : updated.has(s.chatId) && !active
        ? "updated"
        : null;

    if (hasInlineRename && renamingKey === s.key) {
      return (
        <li key={s.key} className="min-w-0">
          <div className="flex items-center gap-1 px-1 pb-0.5 pt-0.5">
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={confirmRename}
              maxLength={40}
              className="h-7 w-full min-w-0 rounded-lg border border-sidebar-border/60 bg-sidebar px-2 text-[12px] font-medium text-sidebar-foreground outline-none ring-0 placeholder:text-muted-foreground/50"
              placeholder={title}
            />
          </div>
        </li>
      );
    }

    return (
      <li key={s.key} className="min-w-0">
        <div
          className={cn(
            "group flex min-w-0 max-w-full items-center gap-2 rounded-xl px-2 text-[13px] transition-colors",
            compact ? "min-h-7" : "min-h-8",
            active
              ? "bg-sidebar-accent/70 text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border)/0.28)]"
              : "text-sidebar-foreground/82 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(s.key)}
            title={tooltipTitle}
            className={cn(
              "min-w-0 flex-1 overflow-hidden text-left",
              compact ? "py-1" : "py-1.5",
              (projectMode || folderMode) && "pl-2",
            )}
          >
            {projectMode ? (
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium leading-5">
                  {title}
                </span>
                {timestamp ? (
                  <span className="shrink-0 text-[11.5px] font-medium text-muted-foreground/58">
                    {timestamp}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="block w-full truncate font-medium leading-5">
                {title}
              </span>
            )}
            {showPreview ? (
              <span className="block w-full truncate text-[11.5px] leading-4 text-muted-foreground/72">
                {preview}
              </span>
            ) : null}
            {timestamp && !projectMode ? (
              <span className="block w-full truncate text-[11px] leading-4 text-muted-foreground/58">
                {timestamp}
              </span>
            ) : null}
          </button>
          <SessionActivityIndicator state={activityState} />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              ref={(el) => {
                if (el instanceof HTMLElement) {
                  deleteTriggerRef.current.set(s.key, el);
                } else {
                  deleteTriggerRef.current.delete(s.key);
                }
              }}
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/75 opacity-40 transition-opacity",
                "hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100",
                "focus-visible:opacity-100",
                active && "opacity-100",
              )}
              aria-label={t("chat.actions", { title })}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={ACTION_MENU_CONTENT_CLASS}
              portalContainer={actionMenuPortalContainer}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem
                onSelect={() => onTogglePin(s.key)}
                className={ACTION_MENU_ITEM_CLASS}
              >
                {isPinned ? (
                  <PinOff className="h-4 w-4 shrink-0" />
                ) : (
                  <Pin className="h-4 w-4 shrink-0" />
                )}
                {isPinned ? t("chat.unpin") : t("chat.pin")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (hasInlineRename) {
                    startRename(s.key, title);
                  } else {
                    onRequestRename(s.key, title);
                  }
                }}
                className={ACTION_MENU_ITEM_CLASS}
              >
                <Pencil className="h-4 w-4 shrink-0" />
                {t("chat.rename")}
              </DropdownMenuItem>
              <MoveToFolderSubMenu
                  sessionKey={s.key}
                  currentFolderId={sessionFolder[s.key] ?? null}
                  folders={folders}
                  onMove={onMoveToFolder}
                  onCreateFolder={onCreateFolder}
                  portalContainer={actionMenuPortalContainer}
                />
              <DropdownMenuItem
                onSelect={() => onToggleArchive(s.key)}
                className={ACTION_MENU_ITEM_CLASS}
              >
                {isArchived ? (
                  <ArchiveRestore className="h-4 w-4 shrink-0" />
                ) : (
                  <Archive className="h-4 w-4 shrink-0" />
                )}
                {isArchived ? t("chat.unarchive") : t("chat.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (hasInlineDelete) {
                    openDeleteConfirm(s.key, title);
                  } else {
                    window.setTimeout(() => onRequestDelete(s.key, title), 0);
                  }
                }}
                className={cn(
                  ACTION_MENU_ITEM_CLASS,
                  "text-destructive focus:text-destructive",
                )}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("chat.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>
    );
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent">
      <div className="min-w-0 space-y-0.5 px-2 py-1.5">
        {limitedGroups.map((group, index) => {
          const foldableChatsGroup = isFoldableChatsGroup(group);
          const foldedChatsGroup = isFoldedChatsGroup(group, collapsedGroups);
          const visibleSessions = visibleSessionsForGroup(
            group,
            activeKey,
            collapsedGroups,
          );
          const hiddenInGroup = Math.max(0, group.sessions.length - visibleSessions.length);
          const canToggleFold = group.sessions.length > COLLAPSED_CHATS_VISIBLE_COUNT;

          return (
            <section key={group.id} aria-label={group.label}>
              {index === firstProjectGroupIndex ? (
                <div className="px-2 pb-1 text-[12px] font-medium text-muted-foreground/65">
                  {labels.projects}
                </div>
              ) : null}
              {group.kind === "project" || group.kind === "folder" ? (
                group.kind === "folder" ? (
                  <FolderGroupHeader
                    label={group.label}
                    sessionCount={group.totalCount ?? group.sessions.length}
                    collapsed={Boolean(collapsedGroups[group.id])}
                    onToggle={() => onToggleGroup?.(group.id)}
                    onRename={
                      (group.id !== "folder:chats" && group.id !== "workspace:chats") && onRenameFolder
                        ? (newName: string) => {
                            const fid = group.id.replace("folder:", "");
                            onRenameFolder(fid, newName);
                          }
                        : undefined
                    }
                    onDelete={
                      (group.id !== "folder:chats" && group.id !== "workspace:chats") && onDeleteFolder
                        ? () => {
                            const fid = group.id.replace("folder:", "");
                            onDeleteFolder(fid);
                          }
                        : undefined
                    }
                    actionMenuPortalContainer={actionMenuPortalContainer}
                  />
                ) : (
                  <ProjectGroupHeader
                    label={group.label}
                    path={group.projectPath}
                    collapsed={Boolean(collapsedGroups[group.id])}
                    onToggle={() => onToggleGroup?.(group.id)}
                    onRequestRename={
                      group.projectKey && onRequestRenameProject
                        ? () => onRequestRenameProject(group.projectKey ?? "", group.label)
                        : undefined
                    }
                    onNewChat={
                      group.projectPath && onNewChatInProject
                        ? () => onNewChatInProject(group.projectPath ?? "", group.label)
                        : undefined
                    }
                    actionMenuPortalContainer={actionMenuPortalContainer}
                    updatedAt={showTimestamps ? group.updatedAt : null}
                  />
                )
              ) : (
                <ChatsGroupHeader label={group.label} />
              )}
              {(group.kind === "project" || group.kind === "folder") && collapsedGroups[group.id] ? null : (
                <ul className="space-y-0.5">
                  {visibleSessions.map((s) => renderSessionRow(s, group))}
                </ul>
              )}
              {foldableChatsGroup && canToggleFold ? (
                <ChatsFoldFooter
                  folded={foldedChatsGroup}
                  hiddenCount={hiddenInGroup}
                  onToggle={() => onToggleGroup?.(group.id)}
                />
              ) : null}
            </section>
          );
        })}
        {hiddenSessionCount > 0 ? (
          <div className="px-2 pb-2 pt-1">
            <button
              type="button"
              onClick={() =>
                setVisibleLimit((limit) =>
                  Math.min(totalSessionCount, limit + VISIBLE_SESSIONS_INCREMENT),
                )
              }
              className="h-8 w-full rounded-full text-[12px] font-medium text-muted-foreground/65 transition-colors hover:bg-sidebar-accent/65 hover:text-muted-foreground"
            >
              {t("chat.showMore", { count: hiddenSessionCount })}
            </button>
          </div>
        ) : null}
      </div>
      {hasInlineDelete && deletingKey && deletePopoverPos
        ? createPortal(
            <div
              className="fixed z-[100] w-52 rounded-lg border border-border/70 bg-popover p-2.5 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-150"
              style={{ top: deletePopoverPos.top, left: deletePopoverPos.left }}
            >
              <div className="flex items-center gap-0.5">
                <span className="min-w-0 flex-1 text-[11px] leading-tight text-popover-foreground/85">
                  {t("deleteConfirm.title")}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={closeDeleteConfirm}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t("deleteConfirm.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  {t("deleteConfirm.confirm")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function FolderGroupHeader({
  label,
  sessionCount,
  collapsed,
  onToggle,
  onRename,
  onDelete,
  actionMenuPortalContainer,
}: {
  label: string;
  sessionCount: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename?: (newName: string) => void;
  onDelete?: () => void;
  actionMenuPortalContainer?: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const actionRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const showMenu = onRename || onDelete;

  const startRename = useCallback(() => {
    setRenameValue(label);
    setIsRenaming(true);
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, [label]);

  const confirmRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== label) {
      onRename?.(trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, label, onRename]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
  }, []);

  const handleDelete = useCallback(() => {
    onDelete?.();
    setShowDeleteConfirm(false);
    setPopoverPos(null);
  }, [onDelete]);

  const openDeleteConfirm = useCallback(() => {
    const el = actionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPopoverPos({
      top: rect.bottom + 4,
      left: rect.right - 208,
    });
    setShowDeleteConfirm(true);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    setPopoverPos(null);
  }, []);

  useEffect(() => {
    if (!showDeleteConfirm) return;
    const timer = window.setTimeout(closeDeleteConfirm, 4000);
    return () => window.clearTimeout(timer);
  }, [showDeleteConfirm, closeDeleteConfirm]);

  if (isRenaming) {
    return (
      <div className="flex items-center gap-1 px-1 pb-0.5 pt-0.5">
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
          onBlur={confirmRename}
          maxLength={40}
          className="h-7 w-full min-w-0 rounded-lg border border-sidebar-border/60 bg-sidebar px-2 text-[12px] font-medium text-sidebar-foreground outline-none ring-0 placeholder:text-muted-foreground/50"
          placeholder={label}
        />
      </div>
    );
  }

  return (
    <div className="group flex min-w-0 items-center gap-1 px-1 pb-0.5 pt-0.5 text-[12px] font-medium text-muted-foreground/65">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-foreground"
      >
        <span className="min-w-0 flex-1 truncate">
          {label}
          <span className="ml-1 text-[11px] text-muted-foreground/55">{sessionCount}</span>
        </span>
      </button>
      {showMenu ? (
        <div ref={actionRef} className="relative shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-40 transition-opacity",
                "hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100 focus-visible:opacity-100",
              )}
              aria-label={t("chat.folderActions")}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={ACTION_MENU_CONTENT_CLASS}
              portalContainer={actionMenuPortalContainer}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {onRename ? (
                <DropdownMenuItem onSelect={startRename} className={ACTION_MENU_ITEM_CLASS}>
                  <Pencil className="h-4 w-4 shrink-0" />
                  {t("chat.rename")}
                </DropdownMenuItem>
              ) : null}
              {onDelete ? (
                <DropdownMenuItem
                  onSelect={openDeleteConfirm}
                  className={cn(ACTION_MENU_ITEM_CLASS, "text-destructive focus:text-destructive")}
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                  {t("chat.delete")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {showDeleteConfirm && popoverPos
            ? createPortal(
                <div
                  className="fixed z-[100] w-52 rounded-lg border border-border/70 bg-popover p-2.5 shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-150"
                  style={{ top: popoverPos.top, left: popoverPos.left }}
                >
                  <div className="flex items-center gap-0.5">
                    <span className="min-w-0 flex-1 text-[11px] leading-tight text-popover-foreground/85">
                      {t("chat.deleteFolderConfirm", { name: label })}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={closeDeleteConfirm}
                      className="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {t("deleteConfirm.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="rounded-md px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                    >
                      {t("deleteConfirm.confirm")}
                    </button>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectGroupHeader({
  label,
  path,
  collapsed,
  onToggle,
  onRequestRename,
  onNewChat,
  actionMenuPortalContainer,
  updatedAt,
}: {
  label: string;
  path?: string;
  collapsed: boolean;
  onToggle: () => void;
  onRequestRename?: () => void;
  onNewChat?: () => void;
  actionMenuPortalContainer?: HTMLElement | null;
  updatedAt?: string | null;
}) {
  const { t } = useTranslation();

  return (
    <div
      title={path}
      className="group flex min-w-0 items-center gap-1 px-1 pb-0.5 pt-0.5 text-[12px] font-medium text-muted-foreground/78"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-sidebar-accent/45 hover:text-sidebar-foreground"
      >
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {updatedAt ? (
        <span className="shrink-0 text-[11px] text-muted-foreground/55">
          {relativeTime(updatedAt)}
        </span>
      ) : null}
      {onRequestRename ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-40 transition-opacity",
              "hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100 focus-visible:opacity-100",
            )}
            aria-label={t("chat.actions", { title: label })}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={ACTION_MENU_CONTENT_CLASS}
            portalContainer={actionMenuPortalContainer}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenuItem onSelect={onRequestRename} className={ACTION_MENU_ITEM_CLASS}>
              <Pencil className="h-4 w-4 shrink-0" />
              {t("chat.rename")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {onNewChat ? (
        <button
          type="button"
          aria-label={t("chat.newInProject", { project: label })}
          title={t("chat.newInProject", { project: label })}
          onClick={(event) => {
            event.stopPropagation();
            onNewChat();
          }}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-40 transition-opacity",
            "hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ChatsGroupHeader({ label }: { label: string }) {
  return (
    <div className="px-2 pb-1 text-[12px] font-medium text-muted-foreground/65">
      {label}
    </div>
  );
}

function ChatsFoldFooter({
  folded,
  hiddenCount,
  onToggle,
}: {
  folded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const collapsedFallback = i18n.resolvedLanguage?.startsWith("zh")
    ? `已折叠 ${hiddenCount} 个对话`
    : `${hiddenCount} hidden chats`;

  return (
    <div className="px-2 pb-1 pt-1">
      <button
        type="button"
        onClick={onToggle}
        className="h-7 w-full rounded-xl text-left text-[12px] font-medium text-muted-foreground/65 transition-colors hover:bg-sidebar-accent/50 hover:text-muted-foreground"
      >
        <span className="px-2">
          {folded
            ? t("chat.collapsed", {
                count: hiddenCount,
                defaultValue: collapsedFallback,
              })
            : t("chat.showLess")}
        </span>
      </button>
    </div>
  );
}

function SessionActivityIndicator({
  state,
}: {
  state: "running" | "updated" | null;
}) {
  const { t } = useTranslation();

  if (state === "running") {
    const label = t("chat.activity.running");
    return (
      <span
        aria-label={label}
        title={label}
        className="grid h-4 w-4 shrink-0 place-items-center"
      >
        <span className="h-3 w-3 animate-spin rounded-full border border-blue-500/25 border-t-blue-500 [animation-duration:1.4s] motion-reduce:animate-none dark:border-blue-400/25 dark:border-t-blue-400" />
      </span>
    );
  }

  if (state === "updated") {
    const label = t("chat.activity.updated");
    return (
      <span
        aria-label={label}
        title={label}
        className="grid h-4 w-4 shrink-0 place-items-center"
      >
        <span className="h-2 w-2 rounded-full bg-[#ff8a3d] shadow-[0_0_0_2px_rgba(255,138,61,0.16)]" />
      </span>
    );
  }

  return <span className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

function MoveToFolderSubMenu({
  sessionKey,
  currentFolderId,
  folders,
  onMove,
  onCreateFolder,
  portalContainer,
}: {
  sessionKey: string;
  currentFolderId: string | null;
  folders: Array<{ id: string; name: string }>;
  onMove?: (sessionKey: string, folderId: string | null) => void;
  onCreateFolder?: (name: string) => Promise<string | null>;
  portalContainer?: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  const startCreate = useCallback(() => {
    setNewName("");
    setIsCreating(true);
    window.setTimeout(() => createInputRef.current?.focus(), 0);
  }, []);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed || !onCreateFolder) return;
    const newFolderId = await onCreateFolder(trimmed);
    if (newFolderId) {
      onMove?.(sessionKey, newFolderId);
    }
    setIsCreating(false);
    setNewName("");
  }, [newName, onCreateFolder, onMove, sessionKey]);

  const cancelCreate = useCallback(() => {
    setIsCreating(false);
    setNewName("");
  }, []);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={ACTION_MENU_SUB_TRIGGER_CLASS}>
        <Folder className="h-4 w-4 shrink-0" />
        {t("chat.moveToFolder")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-[9rem] min-w-[9rem]"
        portalContainer={portalContainer}
      >
        {folders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onSelect={() => onMove?.(sessionKey, folder.id)}
            disabled={folder.id === currentFolderId}
            className="text-[13px]"
          >
            <span className="truncate">{folder.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() => onMove?.(sessionKey, null)}
          disabled={currentFolderId === null}
          className="text-[13px] text-muted-foreground"
        >
          Chats
        </DropdownMenuItem>
        {isCreating ? (
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className="px-2 py-0 focus:bg-transparent"
          >
            <input
              ref={createInputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCreate();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelCreate();
                }
              }}
              onBlur={cancelCreate}
              maxLength={40}
              placeholder={t("chat.folderName")}
              className="h-7 w-full min-w-0 rounded border border-sidebar-border/50 bg-transparent px-2 text-[12px] text-sidebar-foreground outline-none ring-0 placeholder:text-muted-foreground/50"
              onClick={(e) => e.stopPropagation()}
            />
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              startCreate();
            }}
            className={ACTION_MENU_ITEM_CLASS}
          >
            <FolderPlus className="h-4 w-4 shrink-0" />
            {t("chat.newFolder")}
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
