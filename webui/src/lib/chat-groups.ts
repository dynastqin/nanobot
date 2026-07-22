import { deriveTitle } from "@/lib/format";
import type { ChatSummary, Folder, SidebarSortMode } from "@/lib/types";
import { normalizeWorkspacePath, projectNameFromPath, sameWorkspacePath } from "@/lib/workspace";

export const COLLAPSED_CHATS_VISIBLE_COUNT = 8;

export interface SessionGroup {
  id: string;
  label: string;
  sessions: ChatSummary[];
  kind?: "project" | "folder";
  projectPath?: string;
  projectKey?: string;
  updatedAt?: string | null;
  totalCount?: number;
}

export interface ChatGroupLabels {
  pinned: string;
  all: string;
  today: string;
  yesterday: string;
  earlier: string;
  archived: string;
  projects: string;
  fallbackTitle: string;
}

export interface ChatGroupingOptions {
  pinnedKeys: string[];
  archivedKeys: string[];
  titleOverrides: Record<string, string>;
  projectNameOverrides: Record<string, string>;
  showArchived: boolean;
  sort: SidebarSortMode;
  defaultWorkspacePath?: string | null;
  folders: Folder[];
  sessionFolder: Record<string, string>;
}

export function groupSessions(
  sessions: ChatSummary[],
  labels: ChatGroupLabels,
  options: ChatGroupingOptions,
): SessionGroup[] {
  if (sessions.some((session) => session.workspaceScope?.project_path)) {
    return groupSessionsByProject(sessions, labels, options);
  }

  const pinned = new Set(options.pinnedKeys);
  const archived = new Set(options.archivedKeys);
  const folders = options.folders ?? [];
  const sessionFolder = options.sessionFolder ?? {};

  // Separate archived sessions
  const archivedSessions: ChatSummary[] = [];
  const activeSessions: ChatSummary[] = [];

  for (const session of sessions) {
    if (archived.has(session.key)) {
      if (options.showArchived) archivedSessions.push(session);
      continue;
    }
    activeSessions.push(session);
  }

  // Separate channels folder from other folders
  const channelsFolder = folders.find(f => f.id === "__channels__");
  const regularFolders = folders.filter(f => f.id !== "__channels__");

  // Build folder groups
  const folderBuckets = new Map<string, ChatSummary[]>();
  const chatsSessions: ChatSummary[] = [];

  for (const session of activeSessions) {
    const fid = sessionFolder[session.key];
    if (fid && folders.some((f) => f.id === fid)) {
      const bucket = folderBuckets.get(fid) ?? [];
      bucket.push(session);
      folderBuckets.set(fid, bucket);
    } else {
      chatsSessions.push(session);
    }
  }

  const groups: SessionGroup[] = [];

  // Add regular folder groups (sorted by latest session activity), above Chats
  const sortedRegularFolders = regularFolders
    .map((folder) => {
      const bucket = folderBuckets.get(folder.id) ?? [];
      let bestTime = 0;
      for (const s of bucket) {
        const t = sessionTime(s, "lastActiveAt");
        if (t > bestTime) bestTime = t;
      }
      return { folder, bestTime };
    })
    .sort((a, b) => {
      if (b.bestTime !== a.bestTime) return b.bestTime - a.bestTime;
      return a.folder.name.localeCompare(b.folder.name, "en", { numeric: true, sensitivity: "base" });
    });
  for (const { folder } of sortedRegularFolders) {
    const bucket = folderBuckets.get(folder.id) ?? [];
    const sorted = sortFolderSessions(bucket, options.sort, options.titleOverrides, pinned);
    groups.push({
      id: `folder:${folder.id}`,
      label: folder.name,
      kind: "folder" as const,
      sessions: sorted,
      totalCount: bucket.length,
    });
  }

  // Add Chats group (always present)
  const sortedChats = sortFolderSessions(chatsSessions, options.sort, options.titleOverrides, pinned);
  groups.push({
    id: "folder:chats",
    label: "Chats",
    kind: "folder" as const,
    sessions: sortedChats,
    totalCount: chatsSessions.length,
  });

  // Add Channels group below Chats
  if (channelsFolder) {
    const bucket = folderBuckets.get("__channels__") ?? [];
    const sorted = sortFolderSessions(bucket, options.sort, options.titleOverrides, pinned);
    groups.push({
      id: "folder:__channels__",
      label: channelsFolder.name,
      kind: "folder" as const,
      sessions: sorted,
      totalCount: bucket.length,
    });
  }

  // Add archived group if needed
  if (archivedSessions.length) {
    groups.push({
      id: "archived",
      label: labels.archived,
      sessions: sortSessions(
        archivedSessions,
        options.sort,
        options.titleOverrides,
      ),
    });
  }

  return groups;
}

export function limitGroups(
  groups: SessionGroup[],
  limit: number,
  activeKey: string | null,
  collapsedGroups: Record<string, boolean>,
): SessionGroup[] {
  let remaining = Math.max(0, limit);
  let activeVisible = !activeKey;
  const out: SessionGroup[] = [];

  for (const group of groups) {
    if (isCollapsedProject(group, collapsedGroups)) {
      out.push({ ...group, sessions: [] });
      continue;
    }
    const visible = remaining > 0
      ? group.sessions.slice(0, remaining)
      : [];
    remaining -= visible.length;
    if (activeKey && visible.some((session) => session.key === activeKey)) {
      activeVisible = true;
    }
    if (visible.length > 0 || group.kind === "folder") {
      out.push({ ...group, sessions: visible });
    }
  }

  if (activeVisible || !activeKey) return out;

  for (const group of groups) {
    if (isCollapsedProject(group, collapsedGroups)) continue;
    const active = group.sessions.find((session) => session.key === activeKey);
    if (!active) continue;
    const existing = out.find((item) => item.id === group.id);
    if (existing) {
      existing.sessions = [...existing.sessions, active];
    } else {
      out.push({ ...group, sessions: [active] });
    }
    return out;
  }

  return out;
}

export function isCollapsedProject(
  group: SessionGroup,
  collapsedGroups: Record<string, boolean>,
): boolean {
  return (group.kind === "project" || group.kind === "folder") && Boolean(collapsedGroups[group.id]);
}

export function isFoldableChatsGroup(group: SessionGroup): boolean {
  return group.id === "date:all";
}

export function isFoldedChatsGroup(
  group: SessionGroup,
  collapsedGroups: Record<string, boolean>,
): boolean {
  return (
    isFoldableChatsGroup(group)
    && group.sessions.length > COLLAPSED_CHATS_VISIBLE_COUNT
    && collapsedGroups[group.id] !== false
  );
}

export function visibleSessionsForGroup(
  group: SessionGroup,
  activeKey: string | null,
  collapsedGroups: Record<string, boolean>,
): ChatSummary[] {
  if (!isFoldedChatsGroup(group, collapsedGroups)) {
    return group.sessions;
  }
  const visible = group.sessions.slice(0, COLLAPSED_CHATS_VISIBLE_COUNT);
  if (!activeKey || visible.some((session) => session.key === activeKey)) {
    return visible;
  }
  const active = group.sessions.find((session) => session.key === activeKey);
  return active ? [...visible, active] : visible;
}

export function displayTitle(
  session: ChatSummary,
  titleOverrides: Record<string, string>,
  fallbackTitle: string,
): string {
  return (
    titleOverrides[session.key]?.trim()
    || session.title?.trim()
    || deriveTitle(session.preview, fallbackTitle)
  );
}

function groupSessionsByProject(
  sessions: ChatSummary[],
  labels: Pick<ChatGroupLabels, "all">,
  options: ChatGroupingOptions,
): SessionGroup[] {
  const archived = new Set(options.archivedKeys);
  const conversations: ChatSummary[] = [];
  const buckets = new Map<string, {
    path?: string;
    label: string;
    sessions: ChatSummary[];
    updatedAt: string | null;
  }>();

  for (const session of sessions) {
    if (archived.has(session.key) && !options.showArchived) {
      continue;
    }
    const scope = session.workspaceScope;
    const path = scope?.project_path || "";
    if (!path || sameWorkspacePath(path, options.defaultWorkspacePath)) {
      conversations.push(session);
      continue;
    }
    const key = normalizeWorkspacePath(path);
    const label = options.projectNameOverrides[key]?.trim()
      || scope?.project_name?.trim()
      || projectNameFromPath(path);
    const bucket = buckets.get(key) ?? {
      path,
      label,
      sessions: [],
      updatedAt: null,
    };
    bucket.sessions.push(session);
    const candidate = session.lastActiveAt ?? session.updatedAt ?? session.createdAt ?? null;
    if (isNewerDate(candidate, bucket.updatedAt)) {
      bucket.updatedAt = candidate;
    }
    buckets.set(key, bucket);
  }

  const pinned = new Set(options.pinnedKeys);
  const groups: SessionGroup[] = Array.from(buckets.entries()).map(([key, bucket]) => ({
    id: `project:${key}`,
    label: bucket.label,
    kind: "project" as const,
    projectPath: bucket.path,
    projectKey: key,
    updatedAt: bucket.updatedAt,
    sessions: sortProjectSessions(
      bucket.sessions,
      options.sort,
      options.titleOverrides,
      pinned,
      archived,
    ),
  }));

  if (conversations.length) {
    const chatsUpdatedAt = conversations.reduce<string | null>(
      (best, s) => {
        const candidate = s.lastActiveAt ?? s.updatedAt ?? s.createdAt ?? null;
        return isNewerDate(candidate, best) ? candidate : best;
      },
      null,
    );

    const folders = options.folders ?? [];
    const sessionFolder = options.sessionFolder ?? {};
    const channelsFolder = folders.find(f => f.id === "__channels__");
    const regularFolders = folders.filter(f => f.id !== "__channels__");

    if (regularFolders.length) {
      // Apply folder grouping to default-workspace conversations
      const folderBuckets = new Map<string, ChatSummary[]>();
      const chatsSessions: ChatSummary[] = [];

      for (const session of conversations) {
        const fid = sessionFolder[session.key];
        if (fid && folders.some((f) => f.id === fid)) {
          const bucket = folderBuckets.get(fid) ?? [];
          bucket.push(session);
          folderBuckets.set(fid, bucket);
        } else {
          chatsSessions.push(session);
        }
      }

      const sortedRegularFolders = regularFolders
        .map((folder) => {
          const bucket = folderBuckets.get(folder.id) ?? [];
          let bestTime = 0;
          for (const s of bucket) {
            const t = sessionTime(s, "lastActiveAt");
            if (t > bestTime) bestTime = t;
          }
          return { folder, bestTime };
        })
        .sort((a, b) => {
          if (b.bestTime !== a.bestTime) return b.bestTime - a.bestTime;
          return a.folder.name.localeCompare(b.folder.name, "en", { numeric: true, sensitivity: "base" });
        });
      for (const { folder } of sortedRegularFolders) {
        const bucket = folderBuckets.get(folder.id) ?? [];
        groups.push({
          id: `folder:${folder.id}`,
          label: folder.name,
          kind: "folder" as const,
          sessions: sortFolderSessions(
            bucket,
            options.sort,
            options.titleOverrides,
            pinned,
          ),
          totalCount: bucket.length,
        });
      }

      groups.push({
        id: "workspace:chats",
        label: labels.all,
        updatedAt: chatsUpdatedAt,
        kind: "folder" as const,
        sessions: sortProjectSessions(
          chatsSessions,
          options.sort,
          options.titleOverrides,
          pinned,
          archived,
        ),
        totalCount: chatsSessions.length,
      });

      // Add Channels group below Chats
      if (channelsFolder) {
        const bucket = folderBuckets.get("__channels__") ?? [];
        groups.push({
          id: "folder:__channels__",
          label: channelsFolder.name,
          kind: "folder" as const,
          sessions: sortFolderSessions(
            bucket,
            options.sort,
            options.titleOverrides,
            pinned,
          ),
          totalCount: bucket.length,
        });
      }
    } else {
      groups.push({
        id: "workspace:chats",
        label: labels.all,
        kind: "folder" as const,
        updatedAt: chatsUpdatedAt,
        sessions: sortProjectSessions(
          conversations,
          options.sort,
          options.titleOverrides,
          pinned,
          archived,
        ),
        totalCount: conversations.length,
      });

      // Add Channels group below Chats (empty when no channel sessions)
      if (channelsFolder) {
        groups.push({
          id: "folder:__channels__",
          label: channelsFolder.name,
          kind: "folder" as const,
          sessions: [],
          totalCount: 0,
        });
      }
    }
  }

  // Only sort project groups by updatedAt; folders and chats stay on top
  groups.sort((a, b) => {
    const aIsProject = a.kind === "project";
    const bIsProject = b.kind === "project";
    if (aIsProject !== bIsProject) return aIsProject ? 1 : -1;
    if (!aIsProject) return 0;
    const timeOrder = dateToTime(b.updatedAt) - dateToTime(a.updatedAt);
    if (timeOrder !== 0) return timeOrder;
    return a.label.localeCompare(b.label, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });

  return groups;
}

function sortProjectSessions(
  sessions: ChatSummary[],
  sort: SidebarSortMode,
  titleOverrides: Record<string, string>,
  pinned: Set<string>,
  archived: Set<string>,
): ChatSummary[] {
  return sortSessions(sessions, sort, titleOverrides).sort((a, b) => {
    const pinOrder = Number(pinned.has(b.key)) - Number(pinned.has(a.key));
    if (pinOrder !== 0) return pinOrder;
    const archiveOrder = Number(archived.has(a.key)) - Number(archived.has(b.key));
    if (archiveOrder !== 0) return archiveOrder;
    return 0;
  });
}

function sortFolderSessions(
  sessions: ChatSummary[],
  sort: SidebarSortMode,
  titleOverrides: Record<string, string>,
  pinned: Set<string>,
): ChatSummary[] {
  return sortSessions(sessions, sort, titleOverrides).sort((a, b) => {
    const pinOrder = Number(pinned.has(b.key)) - Number(pinned.has(a.key));
    return pinOrder;
  });
}

function sortSessions(
  sessions: ChatSummary[],
  sort: SidebarSortMode,
  titleOverrides: Record<string, string>,
): ChatSummary[] {
  const copy = [...sessions];
  copy.sort((a, b) => {
    if (sort === "title_asc") {
      const titleOrder = titleForSort(a, titleOverrides).localeCompare(
        titleForSort(b, titleOverrides),
        "en",
        { numeric: true, sensitivity: "base" },
      );
      if (titleOrder !== 0) return titleOrder;
      return sessionTime(b, "lastActiveAt") - sessionTime(a, "lastActiveAt");
    }
    const aTime = sessionTime(a, sort === "created_desc" ? "createdAt" : "lastActiveAt");
    const bTime = sessionTime(b, sort === "created_desc" ? "createdAt" : "lastActiveAt");
    return bTime - aTime;
  });
  return copy;
}

function isNewerDate(a: string | null, b: string | null): boolean {
  return dateToTime(a) > dateToTime(b);
}

function dateToTime(value: string | null | undefined): number {
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : 0;
}

function titleForSort(
  session: ChatSummary,
  titleOverrides: Record<string, string>,
): string {
  return (
    titleOverrides[session.key]?.trim()
    || session.title?.trim()
    || deriveTitle(session.preview, "new chat")
  ).toLocaleLowerCase("en");
}

function sessionTime(session: ChatSummary, field: "createdAt" | "updatedAt" | "lastActiveAt"): number {
  const value = field === "lastActiveAt"
    ? (session.lastActiveAt ?? session.updatedAt ?? session.createdAt)
    : session[field];
  const ts = Date.parse(value ?? "");
  return Number.isFinite(ts) ? ts : 0;
}
