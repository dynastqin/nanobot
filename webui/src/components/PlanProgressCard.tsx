import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanStateWsPayload } from "@/lib/types";

interface PlanProgressCardProps {
  planState: PlanStateWsPayload | null | undefined;
  className?: string;
}

export const PlanProgressCard: FC<PlanProgressCardProps> = ({
  planState,
  className,
}) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  if (!planState) return null;

  const { title, steps } = planState;
  if (!steps || steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;
  const totalCount = steps.length;
  const isCompleted = !!planState.completed;

  const statusLabel = isCompleted
    ? t("plan.completed")
    : t("plan.executing");

  return (
    <div
      className={cn(
        "mb-3 rounded-lg border border-border/60 bg-muted/20 transition-all",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-[12px] font-medium text-muted-foreground shrink-0">
          {statusLabel}
        </span>
        <span className="text-[12px] font-medium text-foreground tabular-nums shrink-0">
          {doneCount} / {totalCount}
        </span>
        <span className="flex-1 text-[12px] text-muted-foreground truncate ml-1">
          {title}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {!collapsed && (
        <div className="px-3 pb-2.5 pt-0.5">
          <ul className="space-y-1.5">
            {steps.map((step, i) => (
              <StepRow
                key={i}
                text={step.text}
                status={step.status}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

interface StepRowProps {
  text: string;
  status: "pending" | "active" | "done" | "blocked";
}

function StepRow({ text, status }: StepRowProps) {
  const { t } = useTranslation();

  const icon = (() => {
    switch (status) {
      case "done":
        return <CheckCircle2 className="size-4 text-emerald-500" />;
      case "active":
        return <Loader2 className="size-4 text-blue-500 animate-spin" />;
      case "blocked":
        return <AlertTriangle className="size-4 text-amber-500" />;
      case "pending":
      default:
        return <Circle className="size-4 text-muted-foreground/50" />;
    }
  })();

  const label = (() => {
    switch (status) {
      case "done":
        return t("plan.stepDone");
      case "active":
        return t("plan.stepActive");
      case "blocked":
        return t("plan.stepBlocked");
      case "pending":
      default:
        return t("plan.stepPending");
    }
  })();

  const textClass =
    status === "done"
      ? "text-muted-foreground line-through"
      : status === "active"
        ? "text-foreground font-medium"
        : status === "blocked"
          ? "text-foreground"
          : "text-muted-foreground";

  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className={cn("text-[13px] leading-snug", textClass)}>
        {text}
      </span>
      <span className="sr-only">({label})</span>
    </li>
  );
}
