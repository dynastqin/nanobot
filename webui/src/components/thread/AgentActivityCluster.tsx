import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileImage,
  Layers,
  Search,
  Server,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { FileReferenceChip } from "@/components/FileReferenceChip";
import { MarkdownText, preloadMarkdownText } from "@/components/MarkdownText";
import { StreamingLabelSheen } from "@/components/MessageBubble";
import { ActivityEvidencePreview } from "@/components/thread/activity/ActivityEvidencePreview";
import { ActivityStep } from "@/components/thread/activity/ActivityStep";
import { DiffPair } from "@/components/thread/activity/DiffPair";
import { FileEditGroup, hasVisibleDiffStats, type FileEditSummary } from "@/components/thread/activity/FileEditRow";
import { SkillLoadRow } from "@/components/thread/activity/SkillLoadRow";
import {
  activityEvidenceFromMessageMedia,
  activityEvidenceFromToolEvent,
  isAgentActivityMember,
  isReasoningOnlyAssistant,
  type ActivityEvidence,
} from "@/lib/activity-timeline";
import { faviconUrls, logoFallbackUrls } from "@/lib/provider-brand";
import { extractSkillName, formatToolCallTrace, isSkillLoadEvent } from "@/lib/tool-traces";
import { cn } from "@/lib/utils";
import { hasToolCallDetails, ToolCallDetailContent } from "@/components/thread/activity/ToolCallDetail";
import { AskUserQuestionCard } from "@/components/thread/activity/AskUserQuestionCard";
import type { CliAppInfo, McpPresetInfo, ToolProgressEvent, UIFileEdit, UIMessage } from "@/lib/types";

export { isAgentActivityMember, isReasoningOnlyAssistant };

export type ReasoningGroup = { kind: "reasoning"; messages: UIMessage[] };
export type TraceGroup = { kind: "trace"; message: UIMessage };
export type ActivityGroup = ReasoningGroup | TraceGroup;

export type ActivityRound = {
  reasoning?: ReasoningGroup;
  traces: TraceGroup[];
};

/**
 * Walk a flat list of activity messages and produce alternating reasoning/trace groups.
 * Consecutive reasoning-only messages merge into one group; every trace message is its own group.
 * Non-activity messages are dropped (caller filters them out upstream).
 */
export function groupActivityMessages(messages: UIMessage[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let reasoningBuffer: UIMessage[] = [];

  const flushReasoning = () => {
    if (reasoningBuffer.length === 0) return;
    groups.push({ kind: "reasoning", messages: reasoningBuffer });
    reasoningBuffer = [];
  };

  for (const message of messages) {
    if (isReasoningOnlyAssistant(message)) {
      reasoningBuffer.push(message);
      continue;
    }
    if (message.kind === "trace") {
      flushReasoning();
      groups.push({ kind: "trace", message });
      continue;
    }
    // Non-activity messages are ignored.
  }
  flushReasoning();
  return groups;
}

export function groupActivityRounds(groups: ActivityGroup[]): ActivityRound[] {
  const rounds: ActivityRound[] = [];
  let current: ActivityRound | null = null;

  for (const group of groups) {
    if (group.kind === "reasoning") {
      if (current) rounds.push(current);
      current = { reasoning: group, traces: [] };
    } else {
      if (!current) current = { traces: [] };
      current.traces.push(group);
    }
  }
  if (current) rounds.push(current);
  return rounds;
}

export interface ReasoningBlockProps {
  messages: UIMessage[];
  streaming: boolean;
  isLast: boolean;
  hasBodyBelow: boolean;
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}

export function ReasoningBlock({
  messages,
  streaming,
  isLast,
  hasBodyBelow,
  onOpenFilePreview,
  onOpenLink,
}: ReasoningBlockProps) {
  const { t } = useTranslation();
  const [userToggled, setUserToggled] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prevStreamingRef = useRef(streaming);

  // Live "now" tick while streaming (for the duration label)
  useEffect(() => {
    if (!streaming) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [streaming]);

  // Hold-open for 900ms when streaming flips to false
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming) {
      setHoldOpen(true);
      const timeout = window.setTimeout(() => setHoldOpen(false), 900);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [streaming]);

  const autoOpen = (streaming || holdOpen) && isLast;
  const open = userToggled ? localOpen : autoOpen;

  // Duration from the group's own messages
  const timestamps = messages
    .map((m) => m.createdAt)
    .filter((value) => Number.isFinite(value));
  const hasTimestamps = timestamps.length > 0;
  const first = hasTimestamps ? Math.min(...timestamps) : 0;
  const last = streaming && first > 1_000_000_000_000
    ? now
    : hasTimestamps ? Math.max(...timestamps) : 0;
  const durationMs = hasTimestamps ? Math.max(0, last - first) : 0;
  const duration = formatActivityDuration(durationMs);
  const reasoningTotalLen = messages.reduce((n, m) => n + (m.reasoning ?? "").length, 0);

  const label = streaming
    ? durationMs <= 0
      ? t("message.activityThinking", { defaultValue: "Thinking…" })
      : t("message.activityThinkingFor", { duration, defaultValue: "Thinking for {{duration}}" })
    : durationMs <= 0
      ? t("message.activityThought", { defaultValue: "Thought" })
      : t("message.activityThoughtFor", { duration, defaultValue: "Thought for {{duration}}" });

  const handleClick = () => {
    setUserToggled(true);
    setLocalOpen(!open);
  };

  useEffect(() => {
    if (reasoningTotalLen > 0) preloadMarkdownText();
  }, [reasoningTotalLen]);

  return (
    <div className={cn("w-full", hasBodyBelow && "mb-2")}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "group flex max-w-full items-center gap-1.5 rounded-md px-1 py-1",
          "text-[12.5px] text-muted-foreground/72 transition-colors hover:text-muted-foreground",
        )}
        aria-expanded={open}
        aria-label={label}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />
        <StreamingLabelSheen active={streaming} className="min-w-0">
          {label}
        </StreamingLabelSheen>
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="ml-1 mt-1 space-y-1 border-l-2 border-muted-foreground/15 pl-3">
          {messages.map((m) => {
            const text = m.reasoning ?? "";
            if (!text.trim()) return null;
            return (
              <MarkdownText
                key={m.id}
                streaming={streaming && !!m.reasoningStreaming}
                onOpenFilePreview={onOpenFilePreview}
                onOpenLink={onOpenLink}
                disableArtifactCard
                className={cn(
                  "min-w-0 text-[12.5px] italic text-muted-foreground/55",
                  "prose-p:my-1 prose-li:my-0.5",
                  "prose-headings:mt-2 prose-headings:mb-1 prose-headings:font-medium",
                  "prose-headings:text-muted-foreground/88 prose-strong:text-muted-foreground",
                  "prose-h1:text-[15px] prose-h2:text-[13.5px] prose-h3:text-[12.5px] prose-h4:text-[12px]",
                  "prose-a:text-blue-500 prose-a:underline hover:prose-a:text-blue-600 dark:prose-a:text-blue-300 dark:hover:prose-a:text-blue-200",
                  "prose-code:text-[0.92em]",
                )}
              >
                {text}
              </MarkdownText>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface TraceActivityCardProps {
  message: UIMessage;
  active: boolean;
  cliAppsByName: Map<string, CliAppInfo>;
  mcpPresetsByName: Map<string, McpPresetInfo>;
}

export function TraceActivityCard({
  message,
  active,
  cliAppsByName,
  mcpPresetsByName,
}: TraceActivityCardProps) {
  const lines = traceLines(message);
  const cliRunsByLine = cliRunMapByTraceLine(message);
  const mcpRunsByLine = mcpRunMapByTraceLine(message);
  const evidenceByLine = toolEvidenceByTraceLine(message);
  const trailingEvidence = activityEvidenceFromMessageMedia(message);
  const renderedRunKeys = new Set<string>();
  const items: ReactNode[] = [];
  let normalLines: string[] = [];

  const eventByLine = useMemo(() => {
    const map = new Map<string, ToolProgressEvent>();
    for (const event of message.toolEvents ?? []) {
      const traceLine = formatToolCallTrace(event);
      if (traceLine) map.set(traceLine, event);
    }
    return map;
  }, [message.toolEvents]);

  const flushNormalLines = (suffix: string) => {
    if (!normalLines.length) return;
    items.push(
      <ul key={`${message.id}:trace:${suffix}`} className="space-y-1">
        {normalLines.map((line, index) => (
          <ActivityTraceRow
            key={`${line}-${suffix}-${index}`}
            line={line}
            active={active && index === normalLines.length - 1}
            evidence={evidenceByLine?.get(line) ?? []}
            toolEvent={eventByLine.get(line)}
          />
        ))}
      </ul>,
    );
    normalLines = [];
  };

  lines.forEach((line, index) => {
    const toolEvent = eventByLine.get(line);

    if (toolEvent && isSkillLoadEvent(toolEvent)) {
      flushNormalLines(String(index));
      const skillName = extractSkillName(toolEvent)!;
      items.push(
        <ul key={`${message.id}:skill:${skillName}:${index}`} className="space-y-1">
          <SkillLoadRow
            name={skillName}
            active={active}
            phase={toolEvent.phase}
            toolEvent={toolEvent}
          />
        </ul>,
      );
      return;
    }

    const cliRun = cliRunsByLine.get(line) ?? parseCliRunTrace(line);
    if (cliRun) {
      flushNormalLines(String(index));
      renderedRunKeys.add(cliRun.key);
      items.push(
        <CliRunGroup
          key={`${message.id}:cli:${cliRun.key}:${index}`}
          runs={[cliRun]}
          active={active}
          cliAppsByName={cliAppsByName}
        />,
      );
      const evidence = evidenceByLine.get(line) ?? [];
      if (evidence.length) {
        items.push(
          <ActivityEvidenceList
            key={`${message.id}:cli-evidence:${cliRun.key}:${index}`}
            evidence={evidence}
          />,
        );
      }
      return;
    }

    const mcpRun = mcpRunsByLine.get(line) ?? parseMcpRunTrace(line);
    if (mcpRun) {
      flushNormalLines(String(index));
      renderedRunKeys.add(mcpRun.key);
      items.push(
        <McpRunGroup
          key={`${message.id}:mcp:${mcpRun.key}:${index}`}
          runs={[mcpRun]}
          active={active}
          mcpPresetsByName={mcpPresetsByName}
          toolEvent={eventByLine.get(line)}
        />,
      );
      const evidence = evidenceByLine.get(line) ?? [];
      if (evidence.length) {
        items.push(
          <ActivityEvidenceList
            key={`${message.id}:mcp-evidence:${mcpRun.key}:${index}`}
            evidence={evidence}
          />,
        );
      }
      return;
    }

    normalLines.push(line);
  });

  flushNormalLines("tail");

  for (const run of cliRunsByLine.values()) {
    if (renderedRunKeys.has(run.key)) continue;
    items.push(
      <CliRunGroup
        key={`${message.id}:cli:${run.key}:event`}
        runs={[run]}
        active={active}
        cliAppsByName={cliAppsByName}
      />,
    );
  }
  for (const run of mcpRunsByLine.values()) {
    if (renderedRunKeys.has(run.key)) continue;
    items.push(
      <McpRunGroup
        key={`${message.id}:mcp:${run.key}:event`}
        runs={[run]}
        active={active}
        mcpPresetsByName={mcpPresetsByName}
      />,
    );
  }

  if (trailingEvidence.length) {
    items.push(
      <ActivityEvidenceList
        key={`${message.id}:media-evidence`}
        evidence={trailingEvidence}
      />,
    );
  }

  if (!items.length) return null;
  return <div className="w-full">{items}</div>;
}

interface ActivityCounts {
  reasoningSteps: number;
  toolCalls: number;
  cliCount: number;
  mcpCount: number;
  skillCount: number;
  fileCount: number;
  added: number;
  deleted: number;
  hasDiffStats: boolean;
  hasEditingFiles: boolean;
  hasFailedFiles: boolean;
  hasDeletedFiles: boolean;
  hasPendingFileEdit: boolean;
  primaryFilePath?: string;
  primaryFileTooltipPath?: string;
  primaryCliName?: string;
  primaryCliStatus?: CliRunStatus;
  primaryMcpName?: string;
  primaryMcpDisplayName?: string;
  primaryMcpStatus?: McpRunStatus;
}

interface CliRunSummary {
  key: string;
  name: string;
  args: string[];
  json: boolean;
  workingDir?: string;
  status: CliRunStatus;
  error?: string;
}

type CliRunStatus = "running" | "done" | "error";
type McpRunStatus = "running" | "done" | "error";

interface McpRunSummary {
  key: string;
  presetName: string;
  displayName: string;
  toolName: string;
  argsPreview: string;
  status: McpRunStatus;
  error?: string;
}

function countActivity(
  messages: UIMessage[],
  fileEdits: FileEditSummary[],
  cliRuns: CliRunSummary[],
  mcpRuns: McpRunSummary[],
): ActivityCounts {
  let reasoningSteps = 0;
  let toolCalls = 0;
  let skillCount = 0;
  const cliCount = cliRuns.length;
  const mcpCount = mcpRuns.length;
  const primaryCli = cliRuns[cliRuns.length - 1];
  const primaryCliName = primaryCli?.name;
  const primaryCliStatus = primaryCli?.status;
  const primaryMcp = mcpRuns[mcpRuns.length - 1];
  for (const m of messages) {
    if (isReasoningOnlyAssistant(m)) {
      reasoningSteps += 1;
      continue;
    }
    if (m.kind === "trace") {
      const lines = traceLines(m);
      const skillEventNames = new Set(
        (m.toolEvents ?? [])
          .filter((e) => isSkillLoadEvent(e))
          .map((e) => formatToolCallTrace(e))
          .filter(Boolean),
      );
      for (const line of lines) {
        if (!isCliRunTraceLine(line) && !isMcpRunTraceLine(line)) {
          if (skillEventNames.has(line)) {
            skillCount += 1;
          } else {
            toolCalls += 1;
          }
        }
      }
    }
  }
  let added = 0;
  let deleted = 0;
  let hasDiffStats = false;
  let hasEditingFiles = false;
  let hasPendingFileEdit = false;
  let failedFileCount = 0;
  let deletedFileCount = 0;
  let primaryFilePath: string | undefined;
  let primaryFileTooltipPath: string | undefined;
  for (const edit of fileEdits) {
    primaryFilePath = edit.path;
    primaryFileTooltipPath = edit.absolute_path || edit.path;
    if (edit.pending) {
      hasPendingFileEdit = true;
    }
    if (edit.status === "editing") {
      hasEditingFiles = true;
    }
    if (edit.status === "error") {
      failedFileCount += 1;
    }
    if (edit.operation === "delete") {
      deletedFileCount += 1;
    }
    if (edit.status === "error" || edit.binary) {
      continue;
    }
    if (!hasVisibleDiffStats(edit)) {
      continue;
    }
    hasDiffStats = true;
    added += edit.added;
    deleted += edit.deleted;
  }
  return {
    reasoningSteps,
    toolCalls,
    cliCount,
    mcpCount,
    skillCount,
    fileCount: fileEdits.length,
    added,
    deleted,
    hasDiffStats,
    hasEditingFiles,
    hasFailedFiles: fileEdits.length > 0 && failedFileCount === fileEdits.length,
    hasDeletedFiles: fileEdits.length > 0 && deletedFileCount === fileEdits.length,
    hasPendingFileEdit,
    primaryFilePath,
    primaryFileTooltipPath,
    primaryCliName,
    primaryCliStatus,
    primaryMcpName: primaryMcp?.presetName,
    primaryMcpDisplayName: primaryMcp?.displayName,
    primaryMcpStatus: primaryMcp?.status,
  };
}

export interface SubagentGroup {
  taskId: string;
  title: string;
  messages: UIMessage[];
  latencyMs?: number;
}

export type SubagentStatus = "pending" | "running" | "completed";

const SUBAGENT_SPAWN_RESULT_RE = /^Subagent \[(.*?)\] started \(id: (.*?)\)\./;

/** Determine the status of a subagent by checking parent messages for its announce. */
export function getSubagentStatus(
  group: SubagentGroup,
  parentMessages: UIMessage[],
  isTurnStreaming: boolean,
): SubagentStatus {
  const announceFound = parentMessages.some(
    (m) =>
      m.role === "assistant" &&
      typeof m.content === "string" &&
      m.content.includes(`[Subagent '${group.title}'`) &&
      (m.content.includes("completed") || m.content.includes("failed")),
  );
  if (announceFound || !isTurnStreaming) return "completed";

  const hasActivity =
    group.messages.some((m) => m.kind === "trace") ||
    group.messages.some((m) => isReasoningOnlyAssistant(m));
  return hasActivity ? "running" : "pending";
}

/** Extract task IDs of spawned subagents from spawn tool results in parent trace messages. */
function extractSpawnedTaskIds(
  parentMessages: UIMessage[],
): { taskId: string; title: string }[] {
  const spawned: { taskId: string; title: string }[] = [];
  for (const msg of parentMessages) {
    if (msg.kind !== "trace" || !msg.toolEvents) continue;
    for (const ev of msg.toolEvents) {
      if (ev.name !== "spawn") continue;
      const result = typeof ev.result === "string" ? ev.result : "";
      const match = SUBAGENT_SPAWN_RESULT_RE.exec(result);
      if (match) {
        spawned.push({ title: match[1], taskId: match[2] });
      }
    }
  }
  return spawned;
}

/** Split activity messages into parent and subagent groups by ``subagentTaskId``. */
export function groupMessagesBySubagent(messages: UIMessage[]): {
  parentMessages: UIMessage[];
  subagentGroups: SubagentGroup[];
} {
  const parentMessages: UIMessage[] = [];
  const subagentMap = new Map<string, { title: string; messages: UIMessage[] }>();

  for (const msg of messages) {
    if (msg.subagentTaskId) {
      const group = subagentMap.get(msg.subagentTaskId);
      if (group) {
        group.messages.push(msg);
        if (msg.subagentTitle) group.title = msg.subagentTitle;
      } else {
        subagentMap.set(msg.subagentTaskId, {
          title: msg.subagentTitle || "Sub-agent",
          messages: [msg],
        });
      }
    } else {
      parentMessages.push(msg);
    }
  }

  return {
    parentMessages,
    subagentGroups: Array.from(subagentMap.entries()).map(([taskId, g]) => {
      let latencyMs: number | undefined;
      for (let i = g.messages.length - 1; i >= 0; i--) {
        const lat = g.messages[i].latencyMs;
        if (typeof lat === "number" && Number.isFinite(lat) && lat >= 0) {
          latencyMs = lat;
          break;
        }
      }
      return {
        taskId,
        title: g.title,
        messages: g.messages,
        latencyMs,
      };
    }),
  };
}

interface AgentActivityClusterProps {
  messages: UIMessage[];
  /** True while the session turn is still running (drives “Working…” copy + header sheen). */
  isTurnStreaming: boolean;
  hasBodyBelow: boolean;
  /** Persisted end-to-end turn latency from the assistant answer, used for history replay. */
  turnLatencyMs?: number;
  cliApps?: CliAppInfo[];
  mcpPresets?: McpPresetInfo[];
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
  /** When provided, subagent groups render as clickable links that open the drawer. */
  onOpenSubagent?: (taskId: string) => void;
}

/**
 * Outer fold wrapping interleaved reasoning-only assistant rows and tool-trace rows.
 * Fixed max height with inner scroll; each block keeps its own small collapsible (reasoning / tools).
 */
export function AgentActivityCluster({
  messages,
  isTurnStreaming,
  hasBodyBelow,
  turnLatencyMs,
  cliApps = [],
  mcpPresets = [],
  onOpenFilePreview,
  onOpenLink,
  onOpenSubagent,
}: AgentActivityClusterProps) {
  const fileEdits = useMemo(
    () => summarizeFileEdits(collectFileEdits(messages), isTurnStreaming),
    [messages, isTurnStreaming],
  );
  const cliAppsByName = useMemo(
    () => new Map(cliApps.map((app) => [app.name.toLowerCase(), app])),
    [cliApps],
  );
  const mcpPresetsByName = useMemo(
    () => new Map(mcpPresets.map((preset) => [preset.name.toLowerCase(), preset])),
    [mcpPresets],
  );

  const counts = countActivity(messages, fileEdits, collectCliRuns(messages), collectMcpRuns(messages));
  const hasQuestion = messages.some((m) => m.questionData);
  const hasVisibleActivity =
    counts.reasoningSteps > 0
    || counts.toolCalls > 0
    || counts.cliCount > 0
    || counts.mcpCount > 0
    || counts.skillCount > 0
    || counts.fileCount > 0
    || hasQuestion;
  const hasOnlyFileActivity = fileEdits.length > 0 && messages.every(messageHasOnlyFileActivity);

  const { parentMessages, subagentGroups } = useMemo(
    () => groupMessagesBySubagent(messages),
    [messages],
  );

  const subagentEntries = useMemo(() => {
    const existingIds = new Set(subagentGroups.map((g) => g.taskId));
    const spawned = isTurnStreaming ? extractSpawnedTaskIds(parentMessages) : [];
    const pendingGroups = spawned
      .filter((s) => !existingIds.has(s.taskId))
      .map((s) => ({ taskId: s.taskId, title: s.title, messages: [] as UIMessage[] }));

    return [
      ...pendingGroups.map((g) => ({ group: g, status: "pending" as SubagentStatus })),
      ...subagentGroups.map((g) => ({
        group: g,
        status: getSubagentStatus(g, parentMessages, isTurnStreaming),
      })),
    ];
  }, [subagentGroups, parentMessages, isTurnStreaming]);

  const hasSubagentEntries = subagentEntries.length > 0;

  const parentGroups = useMemo(() => groupActivityMessages(parentMessages), [parentMessages]);
  const parentRounds = useMemo(() => groupActivityRounds(parentGroups), [parentGroups]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isTurnStreaming) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [isTurnStreaming]);

  const totalDuration = useMemo(() => {
    if (turnLatencyMs != null) return formatActivityDuration(turnLatencyMs);
    // Check messages for latencyMs (used by subagent_end events)
    for (let i = messages.length - 1; i >= 0; i--) {
      const lat = messages[i].latencyMs;
      if (typeof lat === "number" && Number.isFinite(lat) && lat >= 0) {
        return formatActivityDuration(lat);
      }
    }
    const timestamps = messages
      .map((m) => m.createdAt)
      .filter((v) => Number.isFinite(v));
    if (!timestamps.length) return "";
    const first = Math.min(...timestamps);
    const last = isTurnStreaming ? now : Math.max(...timestamps);
    const ms = Math.max(0, last - first);
    return ms > 0 ? formatActivityDuration(ms) : "";
  }, [messages, turnLatencyMs, isTurnStreaming, now]);

  if (!hasVisibleActivity) return null;

  if (hasOnlyFileActivity && !hasSubagentEntries) {
    const singleFilePath = counts.fileCount === 1 ? counts.primaryFilePath : undefined;
    const singleFileTooltipPath = counts.fileCount === 1 ? counts.primaryFileTooltipPath : undefined;
    const hasLiveEditingFiles = isTurnStreaming && counts.hasEditingFiles;
    return (
      <FileEditFlatActivity
        edits={fileEdits}
        active={isTurnStreaming}
        hasBodyBelow={hasBodyBelow}
        summary={fileOnlySummary(counts, isTurnStreaming)}
        singleFilePath={singleFilePath}
        singleFileTooltipPath={singleFileTooltipPath}
        hasLiveEditingFiles={hasLiveEditingFiles}
        hasFailedFiles={counts.hasFailedFiles}
        hasDeletedFiles={counts.hasDeletedFiles}
        added={counts.added}
        deleted={counts.deleted}
        hasDiffStats={counts.hasDiffStats}
        onOpenFilePreview={onOpenFilePreview}
      />
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", hasBodyBelow && "mb-2")}>
      {parentRounds.map((round, roundIndex) => {
        const isLastRound = roundIndex === parentRounds.length - 1;
        const reasoningIsLast = isLastRound && round.traces.length === 0;

        return (
          <ActivityRoundContainer
            key={`round:${roundIndex}`}
            round={round}
            isLastRound={isLastRound}
            reasoningIsLast={reasoningIsLast}
            isTurnStreaming={isTurnStreaming}
            cliAppsByName={cliAppsByName}
            mcpPresetsByName={mcpPresetsByName}
            onOpenFilePreview={onOpenFilePreview}
            onOpenLink={onOpenLink}
          />
        );
      })}
      {subagentEntries.map(({ group, status }) =>
        onOpenSubagent ? (
          <SubagentLinkButton
            key={`subagent:${group.taskId}`}
            group={group}
            status={status}
            onClick={() => onOpenSubagent(group.taskId)}
          />
        ) : (
          <SubagentActivityGroup
            key={`subagent:${group.taskId}`}
            group={group}
            isTurnStreaming={isTurnStreaming}
            cliAppsByName={cliAppsByName}
            mcpPresetsByName={mcpPresetsByName}
            onOpenFilePreview={onOpenFilePreview}
            onOpenLink={onOpenLink}
          />
        ),
      )}
      {totalDuration && (
        <div className="flex items-center gap-1.5 px-1">
          <span className="text-[11px] text-muted-foreground/45">
            {isTurnStreaming
              ? `Working for ${totalDuration}`
              : `Worked for ${totalDuration}`}
          </span>
        </div>
      )}
      {fileEdits.length ? (
        <FileEditGroup edits={fileEdits} onOpenFilePreview={onOpenFilePreview} />
      ) : null}
    </div>
  );
}

function ActivityRoundContainer({
  round,
  isLastRound,
  reasoningIsLast,
  isTurnStreaming,
  cliAppsByName,
  mcpPresetsByName,
  onOpenFilePreview,
  onOpenLink,
}: {
  round: ActivityRound;
  isLastRound: boolean;
  reasoningIsLast: boolean;
  isTurnStreaming: boolean;
  cliAppsByName: Map<string, CliAppInfo>;
  mcpPresetsByName: Map<string, McpPresetInfo>;
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}) {
  const questionTraces = round.traces.filter((t) => t.message.questionData);
  const normalTraces = round.traces.filter((t) => !t.message.questionData);
  const hasNormalContent = round.reasoning || normalTraces.length > 0;

  return (
    <>
      {hasNormalContent && (
        <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2">
          {round.reasoning && (
            <ReasoningBlock
              messages={round.reasoning.messages}
              streaming={
                isTurnStreaming
                && reasoningIsLast
                && round.reasoning.messages.some((m) => m.reasoningStreaming || m.isStreaming)
              }
              isLast={reasoningIsLast}
              hasBodyBelow={false}
              onOpenFilePreview={onOpenFilePreview}
              onOpenLink={onOpenLink}
            />
          )}
          {normalTraces.map((trace, traceIndex) => {
            const isLastTrace = isLastRound && traceIndex === normalTraces.length - 1;
            return (
              <TraceActivityCard
                key={`trace:${trace.message.id}`}
                message={trace.message}
                active={isTurnStreaming && isLastTrace}
                cliAppsByName={cliAppsByName}
                mcpPresetsByName={mcpPresetsByName}
              />
            );
          })}
        </div>
      )}
      {questionTraces.map((trace) => (
        <AskUserQuestionCard
          key={`question:${trace.message.id}`}
          data={trace.message.questionData!}
        />
      ))}
    </>
  );
}

function fileOnlySummary(counts: ActivityCounts, active: boolean): string {
  const fileCount = counts.fileCount;
  const hasLiveEditingFiles = active && counts.hasEditingFiles;
  const verb = fileActivityVerb(hasLiveEditingFiles, counts.hasFailedFiles, counts.hasDeletedFiles);
  const singleFilePath = fileCount === 1 ? counts.primaryFilePath : undefined;
  if (counts.hasPendingFileEdit && !singleFilePath) {
    return "Preparing edit…";
  }
  if (singleFilePath) {
    return `${verb} ${shortFileName(singleFilePath)}`;
  }
  return `${verb} ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
}

function messageHasOnlyFileActivity(message: UIMessage): boolean {
  if (message.kind !== "trace" || !message.fileEdits?.length) return false;
  return traceLines(message).every((line) => !line.trim() || isFileEditTraceLine(line));
}

function FileEditFlatActivity({
  edits,
  active,
  hasBodyBelow,
  summary,
  singleFilePath,
  singleFileTooltipPath,
  hasLiveEditingFiles,
  hasFailedFiles,
  hasDeletedFiles,
  added,
  deleted,
  hasDiffStats,
  onOpenFilePreview,
}: {
  edits: FileEditSummary[];
  active: boolean;
  hasBodyBelow: boolean;
  summary: string;
  singleFilePath?: string;
  singleFileTooltipPath?: string;
  hasLiveEditingFiles: boolean;
  hasFailedFiles: boolean;
  hasDeletedFiles: boolean;
  added: number;
  deleted: number;
  hasDiffStats: boolean;
  onOpenFilePreview?: (path: string) => void;
}) {
  const showRows = edits.length > 1 || edits.some((edit) => edit.status === "error" || edit.pending);
  return (
    <div className={cn("w-full", hasBodyBelow && "mb-2")} aria-label={summary}>
      <div
        className={cn(
          "flex max-w-full items-center gap-1.5 px-1 py-1",
          "text-[12.5px] text-muted-foreground/72",
        )}
      >
        <StreamingLabelSheen active={active} className="min-w-0">
          {singleFilePath
            ? fileActivityVerb(hasLiveEditingFiles, hasFailedFiles, hasDeletedFiles)
            : summary}
        </StreamingLabelSheen>
        {singleFilePath ? (
          <FileReferenceChip
            path={singleFilePath}
            tooltipPath={singleFileTooltipPath}
            previewPath={singleFileTooltipPath || singleFilePath}
            onOpen={onOpenFilePreview}
            active={hasLiveEditingFiles}
            className="-my-0.5 min-w-0"
            textClassName="text-xs"
            testId="activity-header-file-reference"
          />
        ) : null}
        {hasDiffStats ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground/85">
            <DiffPair added={added} deleted={deleted} />
          </span>
        ) : null}
      </div>
      {showRows ? (
        <div className="mt-0.5 pl-4">
          <FileEditGroup edits={edits} onOpenFilePreview={onOpenFilePreview} />
        </div>
      ) : null}
    </div>
  );
}

function shortFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function formatActivityDuration(ms: number): string {
  const seconds = ms > 0 && ms < 1000 ? 1 : Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function traceLines(message: UIMessage): string[] {
  if (message.traces?.length) return message.traces;
  return message.content.trim() ? [message.content] : [];
}

function traceLabelColor(kind: string): string {
  if (kind === "search") return "text-violet-600 dark:text-violet-400";
  if (kind === "done") return "text-emerald-500/75";
  if (kind === "tool") return "text-sky-600 dark:text-sky-400";
  return "text-muted-foreground/85";
}

function ActivityTraceRow({
  line,
  active,
  evidence = [],
  toolEvent,
}: {
  line: string;
  active: boolean;
  evidence?: ActivityEvidence[];
  toolEvent?: ToolProgressEvent;
}) {
  const trace = describeTraceLine(line, toolEvent);
  const Icon = trace.kind === "search"
    ? Search
    : trace.kind === "done"
      ? CheckCircle2
      : trace.kind === "tool"
        ? Wrench
        : Layers;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showDetails = toolEvent && hasToolCallDetails(toolEvent);

  const displayLabel = trace.label;

  const labelColor = trace.error
    ? "text-red-600 dark:text-red-400"
    : !active
      ? "text-emerald-500/75"
      : traceLabelColor(trace.kind);

  return (
    <ActivityStep
      as="li"
      marker={<TraceIconMark trace={trace} fallbackIcon={Icon} active={active} />}
      active={active && trace.kind !== "done" && !trace.error}
      tone={trace.error ? "error" : trace.kind === "done" ? "success" : active ? "active" : "neutral"}
      label={displayLabel}
      detail={trace.detail}
      labelClassName={labelColor}
      onClick={showDetails ? () => setDetailsOpen(!detailsOpen) : undefined}
      aside={
        showDetails ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDetailsOpen(!detailsOpen); }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/55 hover:text-muted-foreground/80 transition-colors shrink-0"
            aria-label={detailsOpen ? "Hide details" : "Show details"}
          >
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : undefined
      }
    >
      <ActivityEvidencePreview evidence={evidence} />
      {detailsOpen && toolEvent ? <ToolCallDetailContent event={toolEvent} /> : null}
    </ActivityStep>
  );
}

function ActivityEvidenceList({ evidence }: { evidence: ActivityEvidence[] }) {
  return (
    <ul className="space-y-1">
      <ActivityStep
        as="li"
        icon={FileImage}
        tone="success"
        label={evidenceLabel(evidence)}
      >
        <ActivityEvidencePreview evidence={evidence} />
      </ActivityStep>
    </ul>
  );
}

function evidenceLabel(evidence: ActivityEvidence[]): string {
  const first = evidence[0]?.attachment.kind;
  if (first === "image") return evidence.length > 1 ? "Found images" : "Found image";
  if (first === "video") return evidence.length > 1 ? "Found videos" : "Found video";
  return evidence.length > 1 ? "Found files" : "Found file";
}

function toolEvidenceByTraceLine(message: UIMessage): Map<string, ActivityEvidence[]> {
  const map = new Map<string, ActivityEvidence[]>();
  for (const event of message.toolEvents ?? []) {
    const evidence = activityEvidenceFromToolEvent(event);
    if (!evidence.length) continue;
    const line = formatToolCallTrace(event);
    if (!line) continue;
    const existing = map.get(line) ?? [];
    map.set(line, [...existing, ...evidence]);
  }
  return map;
}

interface TraceDescription {
  kind: "search" | "tool" | "done" | "trace";
  label: string;
  detail: string;
  url?: string;
  host?: string;
  error?: boolean;
}

function TraceIconMark({
  trace,
  fallbackIcon: FallbackIcon,
  active,
}: {
  trace: TraceDescription;
  fallbackIcon: LucideIcon;
  active: boolean;
}) {
  const [faviconIndex, setFaviconIndex] = useState(0);
  const faviconUrl = trace.host ? faviconUrls(trace.host)[faviconIndex] : undefined;

  useEffect(() => setFaviconIndex(0), [trace.host]);

  if (trace.url && trace.host && faviconUrl) {
    return (
      <span
        data-testid={`activity-web-favicon-${trace.host}`}
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-border/45 bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]",
          active && "animate-pulse",
        )}
        aria-hidden
      >
        <img
          src={faviconUrl}
          alt=""
          className="h-3.5 w-3.5 object-contain"
          onError={() => setFaviconIndex((index) => index + 1)}
        />
      </span>
    );
  }

  return (
    <FallbackIcon
      className={cn(
        "h-3.5 w-3.5 shrink-0",
        trace.kind === "done"
          ? "text-emerald-500/75"
          : active
            ? "text-muted-foreground/75"
            : "text-muted-foreground/45",
      )}
      aria-hidden
    />
  );
}

function extractProviderFromResult(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  const match = /^\[provider:\s*([^\]]+)\]/.exec(result);
  return match?.[1] || undefined;
}

function extractQuestionText(event?: ToolProgressEvent): string {
  const args = parseToolEventArguments(event);
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const questions = Array.isArray(record.questions) ? record.questions : [];
  const texts = questions
    .map((q) => (q && typeof q === "object" ? (q as Record<string, unknown>).question : undefined))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim());
  if (!texts.length) return "";
  const joined = texts.join(" / ");
  return truncateMiddle(joined, 80);
}

function extractPlanTitle(result: unknown): string {
  if (typeof result !== "string") return "";
  const match = result.match(/^# Plan:\s*(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function previewToolEventDetail(event?: ToolProgressEvent): string {
  if (!event) return "";
  const args = parseToolEventArguments(event);
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const parts: string[] = [];
  const action = record.action;
  if (typeof action === "string" && action.trim()) {
    parts.push(action.trim());
  }
  // Title from arguments (e.g. plan create), or extracted from result (e.g. plan update)
  const title = (typeof record.title === "string" && record.title.trim())
    || extractPlanTitle(event.result);
  if (title) {
    parts.push(truncateMiddle(title, 60));
  }
  return parts.join(": ");
}

function previewGenericArgs(event?: ToolProgressEvent): string {
  if (!event) return "";
  const args = parseToolEventArguments(event);
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const values: string[] = [];
  for (const value of Object.values(record)) {
    const p = previewScalar(value);
    if (p !== null) values.push(truncateMiddle(String(p), 80));
    if (values.length >= 3) break;
  }
  return values.join(", ");
}

function toolEventHasError(event?: ToolProgressEvent): boolean {
  if (!event) return false;
  if (event.phase === "error") return true;
  if (event.error != null) return true;
  return false;
}

function extractArgField(event: ToolProgressEvent | undefined, field: string): string {
  if (!event) return "";
  const args = parseToolEventArguments(event);
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  const val = record[field];
  if (typeof val === "string" && val.trim()) return val.trim();
  return "";
}

function describeTraceLine(line: string, toolEvent?: ToolProgressEvent): TraceDescription {
  const trimmed = line.trim();
  const functionMatch = /^([a-zA-Z0-9_.-]+)\((.*)\)$/.exec(trimmed);
  const name = functionMatch?.[1] ?? "";
  const args = functionMatch?.[2] ?? "";
  const parsedUrl = traceUrlFromArgs(args, trimmed);
  const webDetail = parsedUrl ? formatTraceUrl(parsedUrl) : "";
  const plainWebReadTrace =
    !!parsedUrl && /\b(fetch(?:ing|ed)?|read(?:ing)?|opened?|opening)\b/i.test(trimmed);
  const errored = toolEventHasError(toolEvent);
  if (name === "spawn") {
    const spawnLabel = extractArgField(toolEvent, "label");
    return { kind: "tool", label: "spawn", detail: spawnLabel || "", error: errored };
  }
  if (name === "long_task") {
    const summary = extractArgField(toolEvent, "ui_summary");
    return { kind: "tool", label: "long_task", detail: summary || "", error: errored };
  }
  if (name === "ask_user_question") {
    const questionText = extractQuestionText(toolEvent);
    return { kind: "tool", label: "ask_user_question", detail: questionText, error: errored };
  }
  if (/^plan$/i.test(name)) {
    const args = parseToolEventArguments(toolEvent);
    const record = (args && typeof args === "object" && !Array.isArray(args)) ? args as Record<string, unknown> : {};
    const action = typeof record.action === "string" && record.action.trim() ? record.action.trim() : "";
    const title = (typeof record.title === "string" && record.title.trim())
      || extractPlanTitle(toolEvent?.result);
    const detail = action
      ? (title ? `· ${action} ${truncateMiddle(title, 60)}` : `· ${action}`)
      : (title ? `· ${truncateMiddle(title, 60)}` : "");
    return { kind: "tool", label: "plan", detail, error: errored };
  }
  if (/search/i.test(name)) {
    const provider = extractProviderFromResult(toolEvent?.result);
    const queryDetail = previewTraceDetail(args, trimmed);
    const detail = provider
      ? `· ${provider} ${queryDetail}`
      : queryDetail ? `· ${queryDetail}` : "";
    return { kind: "search", label: name, detail, error: errored };
  }
  if (/fetch|read|open/i.test(name) || plainWebReadTrace) {
    return {
      kind: "tool",
      label: name,
      detail: webDetail || previewTraceDetail(args, trimmed),
      url: parsedUrl?.href,
      host: parsedUrl ? displayHost(parsedUrl.hostname) : undefined,
      error: errored,
    };
  }
  if (isShellTraceName(name)) {
    return {
      kind: "tool",
      label: name,
      detail: previewShellTraceDetail(args, trimmed),
      error: errored,
    };
  }
  if (name) {
    const argsDetail = previewToolEventDetail(toolEvent) || previewGenericArgs(toolEvent);
    return { kind: "tool", label: name, detail: argsDetail || "", error: errored };
  }
  if (/done|complete|success/i.test(trimmed)) {
    return { kind: "done", label: "Done", detail: trimmed };
  }
  return { kind: "trace", label: "Working", detail: trimmed, error: errored };
}

function isShellTraceName(name: string): boolean {
  const compact = name.toLowerCase().split(".").pop() || name.toLowerCase();
  return new Set([
    "exec",
    "exec_command",
    "execute_command",
    "run_command",
    "run_shell",
    "shell",
    "terminal",
    "bash",
    "sh",
  ]).has(compact);
}

function previewShellTraceDetail(args: string, fallback: string): string {
  const command = shellCommandFromArgs(args) || fallback;
  return summarizeShellCommand(command);
}

function shellCommandFromArgs(args: string): string {
  const compactArgs = args.trim();
  if (!compactArgs) return "";
  try {
    const parsed = JSON.parse(compactArgs) as unknown;
    if (typeof parsed === "string") return parsed;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const record = parsed as Record<string, unknown>;
    for (const key of ["command", "cmd", "script", "input"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  } catch {
    return compactArgs.replace(/^["']|["']$/g, "");
  }
  return "";
}

function summarizeShellCommand(command: string): string {
  const redacted = redactShellCommand(command.replace(/\r\n/g, "\n"));
  const lines = redacted
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = compactShellPath(lines[0] || "command");
  const firstPreview = truncateMiddle(firstLine, 92);
  if (lines.length <= 1) return firstPreview;
  return `${firstPreview} · script, ${lines.length} lines`;
}

function redactShellCommand(command: string): string {
  return command
    .replace(/\b((?:[A-Z0-9_]*)(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH)(?:[A-Z0-9_]*))=(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1=••••")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 ••••")
    .replace(/(--(?:api-?key|token|secret|password)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1••••")
    .replace(/([?&](?:api_?key|token|secret|password)=)[^&\s]+/gi, "$1••••");
}

function compactShellPath(value: string): string {
  return value
    .replace(/\/Users\/[^/\s"']+/g, "~")
    .replace(/\/private\/tmp\/[^\s"']+/g, "/tmp/…")
    .replace(/\/var\/folders\/[^\s"']+/g, "/var/folders/…");
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 1) * 0.62);
  const tail = Math.floor((maxLength - 1) * 0.38);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function traceUrlFromArgs(args: string, fallback: string): URL | null {
  const candidates: string[] = [];
  const compactArgs = args.trim();
  if (compactArgs) {
    try {
      collectUrlCandidates(JSON.parse(compactArgs), candidates);
    } catch {
      candidates.push(compactArgs.replace(/^["']|["']$/g, ""));
    }
  }
  candidates.push(fallback);
  for (const candidate of candidates) {
    const url = parsePublicHttpUrl(candidate);
    if (url) return url;
    const embedded = candidate.match(/https?:\/\/[^\s"'<>),]+/i)?.[0];
    if (embedded) {
      const embeddedUrl = parsePublicHttpUrl(embedded);
      if (embeddedUrl) return embeddedUrl;
    }
  }
  return null;
}

function collectUrlCandidates(value: unknown, candidates: string[]) {
  if (typeof value === "string") {
    candidates.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 6)) collectUrlCandidates(item, candidates);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "uri", "href", "link"]) {
    if (typeof record[key] === "string") candidates.push(record[key]);
  }
}

function parsePublicHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isPrivateHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, aText, bText] = ipv4;
    const a = Number(aText);
    const b = Number(bText);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

function displayHost(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function formatTraceUrl(url: URL): string {
  const host = displayHost(url.hostname);
  const path = url.pathname && url.pathname !== "/" ? url.pathname : "";
  return `${host}${path}`;
}

function previewTraceDetail(args: string, fallback: string): string {
  const compactArgs = args.trim();
  if (!compactArgs) return truncateMiddle(fallback, 160);
  try {
    const parsed = JSON.parse(compactArgs) as unknown;
    const preview = previewMcpArgs(parsed);
    if (preview) return preview;
  } catch {
    // Keep the original trace text for non-JSON progress hints.
  }
  return truncateMiddle(compactArgs.replace(/^["']|["']$/g, ""), 160);
}

const CLI_RUN_TOOL_NAMES = new Set(["run_cli_app", "cli_anything_run"]);
const CLI_RUN_STATUS_RANK: Record<CliRunStatus, number> = { running: 1, done: 2, error: 3 };
const MCP_RUN_STATUS_RANK: Record<McpRunStatus, number> = { running: 1, done: 2, error: 3 };
const MCP_TOOL_NAME_RE = /^mcp_([a-z0-9_-]+?)_(.+)$/i;

function isCliRunTraceLine(line: string): boolean {
  return /^(run_cli_app|cli_anything_run)\(/.test(line.trim());
}

function isMcpRunTraceLine(line: string): boolean {
  return MCP_TOOL_NAME_RE.test(line.trim().split("(", 1)[0] ?? "");
}

function isFileEditTraceLine(line: string): boolean {
  return /^(write_file|edit_file|apply_patch)\(/.test(line.trim());
}

function parseCliRunTrace(line: string, status: CliRunStatus = "running"): CliRunSummary | null {
  const match = /^(run_cli_app|cli_anything_run)\((.*)\)$/.exec(line.trim());
  if (!match) return null;
  const argsText = match[2].trim();
  let argsObject: unknown = {};
  if (argsText) {
    try {
      argsObject = JSON.parse(argsText);
    } catch {
      return {
        key: line,
        name: "cli",
        args: [argsText],
        json: false,
        status,
      };
    }
  }
  return cliRunFromArguments(argsObject, { key: line, status });
}

function parseToolEventArguments(event?: ToolProgressEvent): unknown {
  if (!event) return {};
  const fnArgs = (event as { function?: { arguments?: unknown } }).function?.arguments;
  const raw = fnArgs ?? event.arguments;
  if (typeof raw !== "string") return raw ?? {};
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { args: [raw] };
  }
}

function cliRunStatusFromPhase(phase: unknown): CliRunStatus {
  if (phase === "error") return "error";
  if (phase === "end") return "done";
  return "running";
}

function cliRunError(event: ToolProgressEvent): string | undefined {
  const error = event.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") return JSON.stringify(error);
  return undefined;
}

function toolEventName(event: ToolProgressEvent): string {
  return typeof (event as { function?: { name?: unknown } }).function?.name === "string"
    ? String((event as { function?: { name?: unknown } }).function?.name)
    : typeof event.name === "string"
      ? event.name
      : "";
}

function cliRunFromArguments(
  argsObject: unknown,
  options: { key: string; status: CliRunStatus; error?: string },
): CliRunSummary {
  if (!argsObject || typeof argsObject !== "object" || Array.isArray(argsObject)) {
    return {
      key: options.key,
      name: "cli",
      args: [],
      json: false,
      status: options.status,
      error: options.error,
    };
  }
  const record = argsObject as Record<string, unknown>;
  const appName = typeof record.name === "string" && record.name.trim()
    ? record.name.trim()
    : "cli";
  const rawArgs = Array.isArray(record.args) ? record.args : [];
  const cliArgs = rawArgs.filter((item): item is string => typeof item === "string");
  return {
    key: options.key,
    name: appName,
    args: cliArgs,
    json: record.json === true || record.json === "true",
    workingDir: typeof record.working_dir === "string" ? record.working_dir : undefined,
    status: options.status,
    error: options.error,
  };
}

function cliRunFromEvent(event: ToolProgressEvent): CliRunSummary | null {
  const name = toolEventName(event);
  if (!CLI_RUN_TOOL_NAMES.has(name)) return null;
  const argsObject = parseToolEventArguments(event);
  const key = event.call_id ? `call:${event.call_id}` : `${name}:${JSON.stringify(argsObject)}`;
  return cliRunFromArguments(argsObject, {
    key,
    status: cliRunStatusFromPhase(event.phase),
    error: cliRunError(event),
  });
}

function cliRunMapByTraceLine(message: UIMessage): Map<string, CliRunSummary> {
  const runsByLine = new Map<string, CliRunSummary>();
  for (const event of message.toolEvents ?? []) {
    const run = cliRunFromEvent(event);
    if (!run) continue;
    const line = formatToolCallTrace(event);
    if (!line) continue;
    runsByLine.set(line, mergeCliRun(runsByLine.get(line), run));
  }
  return runsByLine;
}

function mergeCliRun(existing: CliRunSummary | undefined, incoming: CliRunSummary): CliRunSummary {
  if (!existing) return incoming;
  return CLI_RUN_STATUS_RANK[incoming.status] >= CLI_RUN_STATUS_RANK[existing.status]
    ? { ...existing, ...incoming }
    : existing;
}

function collectCliRuns(messages: UIMessage[]): CliRunSummary[] {
  const runsByKey = new Map<string, CliRunSummary>();
  for (const message of messages) {
    if (message.kind !== "trace") continue;
    let hasStructuredCliRun = false;
    for (const event of message.toolEvents ?? []) {
      const run = cliRunFromEvent(event);
      if (!run) continue;
      hasStructuredCliRun = true;
      runsByKey.set(run.key, mergeCliRun(runsByKey.get(run.key), run));
    }
    if (hasStructuredCliRun) continue;
    for (const line of traceLines(message)) {
      const run = parseCliRunTrace(line);
      if (!run || runsByKey.has(run.key)) continue;
      runsByKey.set(run.key, run);
    }
  }
  return [...runsByKey.values()];
}

function previewScalar(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function previewMcpArgs(argsObject: unknown): string {
  if (!argsObject || typeof argsObject !== "object" || Array.isArray(argsObject)) {
    return truncateMiddle(previewScalar(argsObject) ?? "", 160);
  }
  const record = argsObject as Record<string, unknown>;
  const entries: string[] = [];
  for (const value of Object.values(record)) {
    const p = previewScalar(value);
    if (p !== null) entries.push(p);
    if (entries.length >= 2) break;
  }
  return truncateMiddle(entries.join(", "), 160);
}

function mcpRunFromToolName(
  toolName: string,
  argsObject: unknown,
  options: { key: string; status: McpRunStatus; error?: string },
): McpRunSummary | null {
  const match = MCP_TOOL_NAME_RE.exec(toolName);
  if (!match) return null;
  const presetName = (match[1] || "").toLowerCase();
  return {
    key: options.key,
    presetName,
    displayName: match[1] || "",
    toolName: match[2] || "",
    argsPreview: previewMcpArgs(argsObject),
    status: options.status,
    error: options.error,
  };
}

function parseMcpRunTrace(line: string, status: McpRunStatus = "running"): McpRunSummary | null {
  const match = /^([a-z0-9_-]+)\((.*)\)$/i.exec(line.trim());
  if (!match || !MCP_TOOL_NAME_RE.test(match[1])) return null;
  const argsText = match[2].trim();
  let argsObject: unknown = {};
  if (argsText) {
    try {
      argsObject = JSON.parse(argsText);
    } catch {
      argsObject = argsText;
    }
  }
  return mcpRunFromToolName(match[1], argsObject, { key: line, status });
}

function mcpRunFromEvent(event: ToolProgressEvent): McpRunSummary | null {
  const argsObject = parseToolEventArguments(event);
  const key = event.call_id ? `call:${event.call_id}` : `${toolEventName(event)}:${JSON.stringify(argsObject)}`;
  const status = cliRunStatusFromPhase(event.phase);
  const error = cliRunError(event);

  if (event.mcp_server && event.mcp_tool) {
    const presetName = event.mcp_server.toLowerCase();
    return {
      key,
      presetName,
      displayName: event.mcp_server,
      toolName: event.mcp_tool,
      argsPreview: previewMcpArgs(argsObject),
      status,
      error,
    };
  }

  const name = toolEventName(event);
  if (!MCP_TOOL_NAME_RE.test(name)) return null;
  return mcpRunFromToolName(name, argsObject, { key, status, error });
}

function mcpRunMapByTraceLine(message: UIMessage): Map<string, McpRunSummary> {
  const runsByLine = new Map<string, McpRunSummary>();
  for (const event of message.toolEvents ?? []) {
    const run = mcpRunFromEvent(event);
    if (!run) continue;
    const line = formatToolCallTrace(event);
    if (!line) continue;
    runsByLine.set(line, mergeMcpRun(runsByLine.get(line), run));
  }
  return runsByLine;
}

function mergeMcpRun(existing: McpRunSummary | undefined, incoming: McpRunSummary): McpRunSummary {
  if (!existing) return incoming;
  return MCP_RUN_STATUS_RANK[incoming.status] >= MCP_RUN_STATUS_RANK[existing.status]
    ? { ...existing, ...incoming }
    : existing;
}

function collectMcpRuns(messages: UIMessage[]): McpRunSummary[] {
  const runsByKey = new Map<string, McpRunSummary>();
  for (const message of messages) {
    if (message.kind !== "trace") continue;
    let hasStructuredMcpRun = false;
    for (const event of message.toolEvents ?? []) {
      const run = mcpRunFromEvent(event);
      if (!run) continue;
      hasStructuredMcpRun = true;
      runsByKey.set(run.key, mergeMcpRun(runsByKey.get(run.key), run));
    }
    if (hasStructuredMcpRun) continue;
    for (const line of traceLines(message)) {
      const run = parseMcpRunTrace(line);
      if (!run || runsByKey.has(run.key)) continue;
      runsByKey.set(run.key, run);
    }
  }
  return [...runsByKey.values()];
}

function displayCliArg(arg: string): string {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function formatCliArgs(run: CliRunSummary): string {
  const args = [...(run.json ? ["--json"] : []), ...run.args].map(displayCliArg);
  return args.join(" ");
}

function fileActivityVerb(editing: boolean, failed: boolean, deleted: boolean): string {
  if (failed) return "Failed";
  if (deleted) return editing ? "Deleting" : "Deleted";
  return editing ? "Editing" : "Edited";
}

function fileEditCallKey(edit: UIFileEdit): string {
  if (edit.call_id) return `${edit.call_id}|${edit.tool}`;
  return `${edit.tool}|${edit.path}`;
}

function collectFileEdits(messages: UIMessage[]): UIFileEdit[] {
  const edits: UIFileEdit[] = [];
  for (const message of messages) {
    if (message.kind === "trace" && message.fileEdits?.length) {
      edits.push(...message.fileEdits);
    }
  }
  return edits;
}

function latestFileEditEvents(edits: UIFileEdit[]): UIFileEdit[] {
  const order: string[] = [];
  const byKey = new Map<string, UIFileEdit>();
  for (const edit of edits) {
    const key = fileEditCallKey(edit);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, edit);
  }
  return order.map((key) => byKey.get(key)).filter(Boolean) as UIFileEdit[];
}

function summarizeFileEdits(edits: UIFileEdit[], active: boolean): FileEditSummary[] {
  interface MutableSummary {
    key: string;
    path: string;
    absolute_path?: string;
    added: number;
    deleted: number;
    approximate: boolean;
    binary: boolean;
    pending: boolean;
    hasSuccessfulChange: boolean;
    hasActiveEditing: boolean;
    hasFailed: boolean;
    operation?: UIFileEdit["operation"];
    error?: string;
  }

  const order: string[] = [];
  const byPath = new Map<string, MutableSummary>();
  for (const edit of latestFileEditEvents(edits)) {
    const key = edit.path || edit.call_id || edit.tool;
    let summary = byPath.get(key);
    if (!summary) {
      summary = {
        key,
        path: edit.path || "",
        absolute_path: edit.absolute_path,
        added: 0,
        deleted: 0,
        approximate: false,
        binary: false,
        pending: false,
        hasSuccessfulChange: false,
        hasActiveEditing: false,
        hasFailed: false,
        operation: undefined,
      };
      byPath.set(key, summary);
      order.push(key);
    }

    if (edit.path && !summary.path) {
      summary.path = edit.path;
    }
    if (edit.absolute_path) {
      summary.absolute_path = edit.absolute_path;
    }
    if (edit.operation === "delete") {
      summary.operation = "delete";
    }
    summary.pending = summary.pending || !!edit.pending || !edit.path;
    if (!edit.path && edit.pending) {
      if (active && edit.status === "editing") {
        summary.hasActiveEditing = true;
        summary.approximate = summary.approximate || !!edit.approximate;
        if (!edit.binary) {
          summary.added += edit.added;
          summary.deleted += edit.deleted;
        }
      }
      continue;
    }
    if (active && edit.status === "editing") {
      summary.hasActiveEditing = true;
      summary.binary = summary.binary || !!edit.binary;
      summary.approximate = summary.approximate || !!edit.approximate;
      if (!edit.binary) {
        summary.added += edit.added;
        summary.deleted += edit.deleted;
      }
      continue;
    }

    if (edit.status === "error") {
      summary.hasFailed = true;
      summary.error = edit.error ?? summary.error;
      continue;
    }

    summary.hasSuccessfulChange = true;
    summary.binary = summary.binary || !!edit.binary;
    summary.approximate = active && (summary.approximate || !!edit.approximate);
    if (!edit.binary) {
      summary.added += edit.added;
      summary.deleted += edit.deleted;
    }
  }

  return order.flatMap((key) => {
    const summary = byPath.get(key)!;
    if (
      !summary.path
      && !summary.hasActiveEditing
      && !summary.hasSuccessfulChange
      && !summary.hasFailed
    ) {
      return [];
    }
    const status: UIFileEdit["status"] = summary.hasActiveEditing
      ? "editing"
      : summary.hasSuccessfulChange
        ? "done"
        : summary.hasFailed
          ? "error"
          : "done";
    return [{
      key: summary.key,
      path: summary.path,
      absolute_path: summary.absolute_path,
      added: summary.added,
      deleted: summary.deleted,
      approximate: summary.approximate,
      binary: summary.binary,
      status,
      operation: summary.operation,
      pending: summary.pending && !summary.path,
      error: summary.error,
    }];
  });
}

function CliRunGroup({
  runs,
  active,
  cliAppsByName,
}: {
  runs: CliRunSummary[];
  active: boolean;
  cliAppsByName: Map<string, CliAppInfo>;
}) {
  if (runs.length === 0) return null;
  return (
    <ul className="space-y-1" data-testid="activity-cli-runs">
      {runs.map((run) => (
        <CliRunRow
          key={run.key}
          run={run}
          active={active}
          app={cliAppsByName.get(run.name.toLowerCase())}
        />
      ))}
    </ul>
  );
}

function CliTextIcon({ className }: { className?: string }) {
  return (
    <span className={cn("font-mono text-[9px] font-bold leading-none", className)}>
      &gt;_
    </span>
  );
}

function CliRunRow({ run, active, app }: { run: CliRunSummary; active: boolean; app?: CliAppInfo }) {
  const [logoIndex, setLogoIndex] = useState(0);
  const args = formatCliArgs(run);
  const failed = run.status === "error";
  const rowActive = active && run.status === "running";
  const color = failed ? "#DC2626" : app?.brand_color || "#0891B2";
  const logoUrls = useMemo(() => logoFallbackUrls(app?.logo_url), [app?.logo_url]);
  const logoUrl = logoUrls[logoIndex];
  const labelText = `@${run.name}`;
  const detail = args || undefined;
  const labelColor = failed
    ? "text-red-600 dark:text-red-400"
    : rowActive
      ? "text-sky-600 dark:text-sky-400"
      : "text-emerald-500/75";

  useEffect(() => setLogoIndex(0), [app?.logo_url]);

  return (
    <ActivityStep
      as="li"
      active={rowActive}
      tone={failed ? "error" : rowActive ? "active" : run.status === "done" ? "success" : "neutral"}
      label={labelText}
      detail={detail}
      labelClassName={labelColor}
      marker={logoUrl ? (
        <span
          data-testid={`activity-cli-logo-${run.name.toLowerCase()}`}
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-[4px] border bg-background",
            rowActive && "animate-pulse",
          )}
          style={{
            borderColor: alphaColor(color, 22),
            boxShadow: rowActive ? `0 0 0 3px ${alphaColor(color, 9)}` : undefined,
          }}
          aria-hidden
        >
          <img
            src={logoUrl}
            alt=""
            className="h-[78%] w-[78%] object-contain"
            onError={() => setLogoIndex((index) => index + 1)}
          />
        </span>
      ) : undefined}
      icon={logoUrl ? undefined : CliTextIcon as unknown as LucideIcon}
    />
  );
}

function McpRunGroup({
  runs,
  active,
  mcpPresetsByName,
  toolEvent,
}: {
  runs: McpRunSummary[];
  active: boolean;
  mcpPresetsByName: Map<string, McpPresetInfo>;
  toolEvent?: ToolProgressEvent;
}) {
  if (runs.length === 0) return null;
  return (
    <ul className="space-y-1" data-testid="activity-mcp-runs">
      {runs.map((run) => (
        <McpRunRow
          key={run.key}
          run={run}
          active={active}
          preset={mcpPresetsByName.get(run.presetName.toLowerCase())}
          toolEvent={toolEvent}
        />
      ))}
    </ul>
  );
}

function McpRunRow({ run, active, preset, toolEvent }: { run: McpRunSummary; active: boolean; preset?: McpPresetInfo; toolEvent?: ToolProgressEvent }) {
  const [logoIndex, setLogoIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const failed = run.status === "error";
  const rowActive = active && run.status === "running";
  const color = failed ? "#DC2626" : preset?.brand_color || "#6D5DF6";
  const logoUrls = useMemo(() => logoFallbackUrls(preset?.logo_url), [preset?.logo_url]);
  const logoUrl = logoUrls[logoIndex];
  const displayName = preset?.display_name || run.displayName;
  const labelText = displayName;
  const detail = `· ${run.toolName}${run.argsPreview ? ` ${run.argsPreview}` : ""}`;
  const labelColor = failed
    ? "text-red-600 dark:text-red-400"
    : rowActive
      ? "text-sky-600 dark:text-sky-400"
      : "text-emerald-500/75";
  const showDetails = toolEvent && hasToolCallDetails(toolEvent);

  useEffect(() => setLogoIndex(0), [preset?.logo_url]);

  return (
    <ActivityStep
      as="li"
      active={rowActive}
      tone={failed ? "error" : rowActive ? "active" : run.status === "done" ? "success" : "neutral"}
      label={labelText}
      detail={detail}
      labelClassName={labelColor}
      onClick={showDetails ? () => setDetailsOpen(!detailsOpen) : undefined}
      aside={
        showDetails ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDetailsOpen(!detailsOpen); }}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/55 hover:text-muted-foreground/80 transition-colors shrink-0"
            aria-label={detailsOpen ? "Hide details" : "Show details"}
          >
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : undefined
      }
      marker={logoUrl ? (
        <span
          data-testid={`activity-mcp-logo-${run.presetName.toLowerCase()}`}
          className={cn(
            "grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-[4px] border bg-background",
            rowActive && "animate-pulse",
          )}
          style={{
            borderColor: alphaColor(color, 22),
            boxShadow: rowActive ? `0 0 0 3px ${alphaColor(color, 9)}` : undefined,
          }}
          aria-hidden
        >
          <img
            src={logoUrl}
            alt=""
            className="h-[78%] w-[78%] object-contain"
            onError={() => setLogoIndex((index) => index + 1)}
          />
        </span>
      ) : undefined}
      icon={logoUrl ? undefined : Server}
    >
      {detailsOpen && toolEvent ? <ToolCallDetailContent event={toolEvent} /> : null}
    </ActivityStep>
  );
}

function alphaColor(color: string, percent: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const alpha = Math.round((percent / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${alpha}`;
  }
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Clickable chip shown in place of inline subagent activity when the drawer is available. */
function SubagentLinkButton({
  group,
  status,
  onClick,
}: {
  group: SubagentGroup;
  status: SubagentStatus;
  onClick: () => void;
}) {
  const toolCount = group.messages.filter((m) => m.kind === "trace").length;
  const reasoningCount = group.messages.filter((m) => isReasoningOnlyAssistant(m)).length;

  const colorSet =
    status === "completed"
      ? {
          border: "border-emerald-400/30",
          bg: "bg-emerald-50/40",
          hoverBg: "hover:bg-emerald-100/50",
          hoverBorder: "hover:border-emerald-400/50",
          darkBg: "dark:bg-emerald-950/20",
          darkHoverBg: "dark:hover:bg-emerald-950/40",
          icon: "text-emerald-500/70",
          title: "text-emerald-700/80 dark:text-emerald-300/80",
        }
      : status === "pending"
        ? {
            border: "border-slate-300/30",
            bg: "bg-slate-50/40",
            hoverBg: "hover:bg-slate-100/50",
            hoverBorder: "hover:border-slate-400/40",
            darkBg: "dark:bg-slate-800/20",
            darkHoverBg: "dark:hover:bg-slate-800/40",
            icon: "text-slate-400/50",
            title: "text-slate-500/70 dark:text-slate-400/60",
          }
        : {
            border: "border-violet-400/30",
            bg: "bg-violet-50/40",
            hoverBg: "hover:bg-violet-100/50",
            hoverBorder: "hover:border-violet-400/50",
            darkBg: "dark:bg-violet-950/20",
            darkHoverBg: "dark:hover:bg-violet-950/40",
            icon: "text-violet-500/70",
            title: "text-violet-700/80 dark:text-violet-300/80",
          };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
        colorSet.border,
        colorSet.bg,
        colorSet.hoverBg,
        colorSet.hoverBorder,
        colorSet.darkBg,
        colorSet.darkHoverBg,
      )}
    >
      <Bot className={cn("h-4 w-4 shrink-0", colorSet.icon)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StreamingLabelSheen
            active={status === "running"}
            className={cn("text-[12.5px] font-medium", colorSet.title)}
          >
            {group.title}
          </StreamingLabelSheen>
          {group.latencyMs != null && (
            <span className="text-[11px] text-muted-foreground/45 shrink-0">
              {formatActivityDuration(group.latencyMs)}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground/65">
          {status === "pending"
            ? "Starting..."
            : [
                reasoningCount ? `${reasoningCount} thoughts` : "",
                toolCount ? `${toolCount} tool calls` : "",
              ]
                .filter(Boolean)
                .join(", ") || "View details"}
        </div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
    </button>
  );
}

/** Collapsible block that renders a subagent's inline activity nested under a
 * labelled header with a left accent border. */
function SubagentActivityGroup({
  group,
  isTurnStreaming,
  cliAppsByName,
  mcpPresetsByName,
  onOpenFilePreview,
  onOpenLink,
}: {
  group: SubagentGroup;
  isTurnStreaming: boolean;
  cliAppsByName: Map<string, CliAppInfo>;
  mcpPresetsByName: Map<string, McpPresetInfo>;
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}) {
  const activityGroups = useMemo(() => groupActivityMessages(group.messages), [group.messages]);
  const rounds = useMemo(() => groupActivityRounds(activityGroups), [activityGroups]);
  const fileEdits = useMemo(
    () => summarizeFileEdits(collectFileEdits(group.messages), isTurnStreaming),
    [group.messages, isTurnStreaming],
  );

  const hasActivity = activityGroups.length > 0;
  if (!hasActivity && !fileEdits.length) return null;

  return (
    <SubagentActivityBlock
      title={group.title}
      isTurnStreaming={isTurnStreaming}
      rounds={rounds}
      fileEdits={fileEdits}
      cliAppsByName={cliAppsByName}
      mcpPresetsByName={mcpPresetsByName}
      onOpenFilePreview={onOpenFilePreview}
      onOpenLink={onOpenLink}
    />
  );
}

function SubagentActivityBlock({
  title,
  isTurnStreaming,
  rounds,
  fileEdits,
  cliAppsByName,
  mcpPresetsByName,
  onOpenFilePreview,
  onOpenLink,
}: {
  title: string;
  isTurnStreaming: boolean;
  rounds: ActivityRound[];
  fileEdits: FileEditSummary[];
  cliAppsByName: Map<string, CliAppInfo>;
  mcpPresetsByName: Map<string, McpPresetInfo>;
  onOpenFilePreview?: (path: string) => void;
  onOpenLink?: (url: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-l-2 border-violet-400/40 pl-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "group flex max-w-full items-center gap-1.5 rounded-md px-1 py-1",
          "text-[12.5px] text-muted-foreground/72 transition-colors hover:text-muted-foreground",
        )}
        aria-expanded={open}
      >
        <Bot className="h-3.5 w-3.5 shrink-0 text-violet-500/70" />
        <StreamingLabelSheen active={isTurnStreaming} className="min-w-0 text-violet-600/80 dark:text-violet-400/80">
          {title}
        </StreamingLabelSheen>
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          {rounds.map((round, roundIndex) => {
            const isLastRound = roundIndex === rounds.length - 1;
            const reasoningIsLast = isLastRound && round.traces.length === 0;
            return (
              <ActivityRoundContainer
                key={`sub:${roundIndex}`}
                round={round}
                isLastRound={isLastRound}
                reasoningIsLast={reasoningIsLast}
                isTurnStreaming={isTurnStreaming}
                cliAppsByName={cliAppsByName}
                mcpPresetsByName={mcpPresetsByName}
                onOpenFilePreview={onOpenFilePreview}
                onOpenLink={onOpenLink}
              />
            );
          })}
          {fileEdits.length > 0 && (
            <FileEditGroup edits={fileEdits} onOpenFilePreview={onOpenFilePreview} />
          )}
        </div>
      )}
    </div>
  );
}
