import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolProgressEvent } from "@/lib/types";

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = useState(false);
  const json = formatJson(value);
  if (!json) return null;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-auto rounded-md bg-muted/40 px-2.5 py-2 max-h-60",
          "font-mono text-[11.5px] leading-relaxed text-foreground/75",
          "border border-border/40",
        )}
      >
        {json}
      </pre>
    </div>
  );
}

function getToolEventArguments(event: ToolProgressEvent): unknown {
  const fnArgs = (event as { function?: { arguments?: unknown } }).function?.arguments;
  return fnArgs ?? event.arguments;
}

export function hasToolCallDetails(event: ToolProgressEvent): boolean {
  const rawArgs = getToolEventArguments(event);
  const hasArgs = rawArgs !== undefined && rawArgs !== null
    && !(typeof rawArgs === "object" && Object.keys(rawArgs as object).length === 0);
  const isRunning = event.phase === "start";
  const isError = event.phase === "error";
  const showResult = !isRunning && (event.result !== undefined || isError);
  return hasArgs || showResult;
}

export function ToolCallDetailContent({ event }: { event: ToolProgressEvent }) {
  const rawArgs = getToolEventArguments(event);
  const hasArgs = rawArgs !== undefined && rawArgs !== null
    && !(typeof rawArgs === "object" && Object.keys(rawArgs as object).length === 0);
  const isRunning = event.phase === "start";
  const isError = event.phase === "error";
  const showResult = !isRunning && (event.result !== undefined || isError);

  return (
    <div className="mt-1.5 pl-0.5 border-l-2 border-border/50">
      {hasArgs && <JsonBlock value={rawArgs} label="Arguments" />}
      {isRunning && (
        <div className="mt-1 text-[11px] italic text-muted-foreground/50">Running…</div>
      )}
      {isError && event.error !== undefined && (
        <JsonBlock value={event.error} label="Error" />
      )}
      {!isRunning && !isError && showResult && (
        <JsonBlock value={event.result} label="Result" />
      )}
    </div>
  );
}

export interface ToolCallDetailProps {
  event: ToolProgressEvent;
  className?: string;
}

export function ToolCallDetail({ event, className }: ToolCallDetailProps) {
  const [open, setOpen] = useState(false);

  if (!hasToolCallDetails(event)) return null;

  return (
    <div className={cn("ml-5 mt-0.5", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground/55 hover:text-muted-foreground/80 transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{open ? "Hide details" : "Show details"}</span>
      </button>
      {open && <ToolCallDetailContent event={event} />}
    </div>
  );
}
