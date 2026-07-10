import { useState } from "react";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ActivityStep } from "@/components/thread/activity/ActivityStep";
import { hasToolCallDetails, ToolCallDetailContent } from "@/components/thread/activity/ToolCallDetail";
import type { ToolProgressEvent } from "@/lib/types";

export interface SkillLoadRowProps {
  name: string;
  active: boolean;
  phase?: "start" | "end" | "error" | string;
  toolEvent?: ToolProgressEvent;
}

export function SkillLoadRow({ name, active, phase = "start", toolEvent }: SkillLoadRowProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const running = phase === "start" && active;
  const failed = phase === "error";
  const done = phase === "end";
  const showDetails = done && toolEvent && hasToolCallDetails(toolEvent);

  const label = failed
    ? t("message.skillLoadFailed", { defaultValue: "Failed to load skill" })
    : running
      ? t("message.skillLoadLoading", { defaultValue: "Loading skill" })
      : t("message.skillLoadLoaded", { defaultValue: "Skill-load" });

  const detail = running || done || failed ? name : undefined;

  return (
    <ActivityStep
      as="li"
      active={done || running}
      tone={failed ? "error" : running ? "active" : "success"}
      label={label}
      detail={detail}
      labelClassName={
        failed
          ? "text-red-600 dark:text-red-400"
          : running
            ? "text-indigo-600 dark:text-indigo-400"
            : "text-emerald-500/75"
      }
      icon={Zap}
      markerClassName={running ? "border-indigo-500/28 text-indigo-500/78" : undefined}
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
      {detailsOpen && toolEvent ? <ToolCallDetailContent event={toolEvent} /> : null}
    </ActivityStep>
  );
}
