import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AskUserQuestionData, AskUserQuestionPayload } from "@/lib/types";
import { useClient } from "@/providers/ClientProvider";

const OTHER_LABEL = "其他";
const LS_KEY = "nanobot_answered_questions";

interface AnsweredEntry {
  answers: Record<string, string>;
  otherTexts: Record<string, string>;
}

function loadAnswered(): Record<string, AnsweredEntry> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    }
  } catch { /* ignore */ }
  return {};
}

function saveAnsweredEntry(questionId: string, entry: AnsweredEntry) {
  const all = loadAnswered();
  all[questionId] = entry;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function isQuestionAnswered(
  q: AskUserQuestionData,
  answers: Record<string, string>,
  otherTexts: Record<string, string>,
): boolean {
  const raw = answers[q.id] || "";
  if (!raw) return false;
  if (raw === OTHER_LABEL && !(otherTexts[q.id]?.trim())) return false;
  return true;
}

interface AskUserQuestionCardProps {
  data: AskUserQuestionPayload;
  onDismiss?: () => void;
}

export function AskUserQuestionCard({ data, onDismiss }: AskUserQuestionCardProps) {
  const { client } = useClient();
  const total = data.questions.length;

  const persisted = loadAnswered()[data.question_id];
  const [answers, setAnswers] = useState<Record<string, string>>(
    persisted?.answers ?? {},
  );
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>(
    persisted?.otherTexts ?? {},
  );
  const [submitted, setSubmitted] = useState(!!persisted);
  const submittedRef = useRef(!!persisted);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const entry = loadAnswered()[data.question_id];
    if (entry) {
      submittedRef.current = true;
      setSubmitted(true);
      setAnswers(entry.answers ?? {});
      setOtherTexts(entry.otherTexts ?? {});
    }
  }, [data.question_id]);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const otherTextsRef = useRef(otherTexts);
  otherTextsRef.current = otherTexts;

  const handleSelect = (questionId: string, value: string, multi: boolean) => {
    if (submittedRef.current) return;
    setAnswers((prev) => {
      if (multi) {
        const current = prev[questionId] || "";
        const parts = current ? current.split(",") : [];
        const idx = parts.indexOf(value);
        if (idx >= 0) {
          parts.splice(idx, 1);
        } else {
          parts.push(value);
        }
        return { ...prev, [questionId]: parts.join(",") };
      }
      return { ...prev, [questionId]: value };
    });
  };

  const handleOtherText = (questionId: string, text: string) => {
    if (submittedRef.current) return;
    setOtherTexts((prev) => ({ ...prev, [questionId]: text }));
  };

  const allAnswered = data.questions.every((q) =>
    isQuestionAnswered(q, answersRef.current, otherTextsRef.current),
  );
  const isLastPage = page === total - 1;
  const current = data.questions[page];

  const handleConfirm = useCallback(() => {
    if (submittedRef.current || !allAnswered) return;
    submittedRef.current = true;
    const latestAnswers = answersRef.current;
    const latestOtherTexts = otherTextsRef.current;
    const resolved: Record<string, string> = {};
    for (const q of data.questions) {
      const raw = latestAnswers[q.id] || "";
      if (!raw) continue;
      const parts = raw.split(",");
      const resolvedParts = parts.map((p) => {
        if (p === OTHER_LABEL) {
          return latestOtherTexts[q.id]?.trim() || OTHER_LABEL;
        }
        return p;
      });
      resolved[q.id] = resolvedParts.join(",");
    }
    saveAnsweredEntry(data.question_id, { answers: latestAnswers, otherTexts: latestOtherTexts });
    setSubmitted(true);
    client.sendAnswer(data.question_id, resolved);
    onDismiss?.();
  }, [client, data, allAnswered, onDismiss]);

  const goNext = useCallback(() => {
    if (isLastPage) {
      handleConfirm();
    } else {
      setPage((p) => Math.min(p + 1, total - 1));
    }
  }, [isLastPage, handleConfirm, total]);

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(p - 1, 0));
  }, []);

  useEffect(() => {
    if (submitted) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        if (isLastPage) {
          handleConfirm();
        } else {
          setPage((p) => Math.min(p + 1, total - 1));
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [submitted, isLastPage, handleConfirm, total]);

  // Reset page when question_id changes
  useEffect(() => {
    setPage(0);
  }, [data.question_id]);

  return (
    <div className="my-3 rounded-xl border border-border bg-card/60 p-4 space-y-4">
      <QuestionBlock
        key={current.id}
        question={current}
        selected={answers[current.id] || ""}
        otherText={otherTexts[current.id] || ""}
        onSelect={(v) => handleSelect(current.id, v, !!current.multiSelect)}
        onOtherText={(t) => handleOtherText(current.id, t)}
        onConfirm={handleConfirm}
        disabled={submitted}
      />

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        {submitted ? null : isLastPage ? (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!allAnswered}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity",
              "bg-primary text-primary-foreground",
              allAnswered
                ? "hover:bg-primary/90"
                : "opacity-40 pointer-events-none",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            Confirm
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        {total > 1 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={goPrev}
              disabled={page === 0}
              className={cn(
                "p-0.5 rounded hover:bg-muted/50 transition-colors",
                page === 0 && "opacity-30 pointer-events-none",
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">{page + 1} / {total}</span>
            <button
              type="button"
              onClick={goNext}
              disabled={page === total - 1}
              className={cn(
                "p-0.5 rounded hover:bg-muted/50 transition-colors",
                page === total - 1 && "opacity-30 pointer-events-none",
              )}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function QuestionBlock({
  question,
  selected,
  otherText,
  onSelect,
  onOtherText,
  onConfirm,
  disabled,
}: {
  question: AskUserQuestionData;
  selected: string;
  otherText: string;
  onSelect: (value: string) => void;
  onOtherText: (text: string) => void;
  onConfirm?: () => void;
  disabled: boolean;
}) {
  const multi = !!question.multiSelect;
  const selectedSet = new Set(selected ? selected.split(",") : []);
  const otherInputRef = useRef<HTMLTextAreaElement>(null);

  const allOptions = [...question.options, { label: OTHER_LABEL, description: "" }];

  return (
    <div className="space-y-2.5">
      <p className="text-sm font-medium text-foreground">{question.question}</p>
      <div className="space-y-0.5">
        {allOptions.map((opt) => {
          const isOther = opt.label === OTHER_LABEL;
          const checked = multi
            ? selectedSet.has(opt.label)
            : selected === opt.label;
          return (
            <div key={opt.label}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(opt.label)}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors",
                  !disabled && "hover:border-primary/50 hover:bg-accent/50",
                  checked
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : opt.recommend && !selected
                      ? "border-primary/70 ring-1 ring-primary/10"
                      : "border-border bg-background",
                  disabled && !checked && "pointer-events-none opacity-40",
                  disabled && checked && "pointer-events-none",
                )}
              >
                <div className="flex items-center gap-2.5">
                  {multi ? (
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30",
                        disabled && !checked && "opacity-40",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        checked
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/30",
                        disabled && !checked && "opacity-40",
                      )}
                    >
                      {checked && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                      )}
                    </span>
                  )}
                  {isOther ? (
                    <div className="flex-1 flex items-center min-w-0">
                      <textarea
                        ref={otherInputRef}
                        value={otherText}
                        onChange={(e) => onOtherText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            onConfirm?.();
                          }
                        }}
                        onFocus={() => {
                          if (!checked && !disabled) {
                            onSelect(OTHER_LABEL);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="其他补充..."
                        disabled={disabled}
                        rows={1}
                        className={cn(
                          "flex-1 min-w-0 rounded-md border bg-background px-2 py-0.5 text-sm resize-none",
                          "placeholder:text-muted-foreground/50",
                          "focus:outline-none focus:border-primary/50",
                          !checked && !disabled && "opacity-50",
                          disabled && "pointer-events-none",
                        )}
                      />
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="font-medium">{opt.label}</span>
                      {opt.description && (
                        <span className="text-muted-foreground">
                          {opt.description}
                        </span>
                      )}
                      {opt.recommend && !disabled && !selected && (
                        <span className="text-[10px] font-medium text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded">
                          Recommended
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
