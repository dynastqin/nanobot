import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[62px] flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium leading-5 text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 max-w-[28rem] text-[12px] leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {children ? <div className="min-w-0 sm:ml-6 sm:shrink-0">{children}</div> : null}
    </div>
  );
}

function ToggleButton({
  checked,
  onChange,
  ariaLabel,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px]",
        "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked
          ? "bg-[#2997FF] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.035)]"
          : "bg-muted shadow-[inset_0_0_0_1px_rgba(0,0,0,0.035)] hover:bg-muted/80",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-[18px] w-[18px] rounded-full bg-background shadow-[0_1px_2px_rgba(0,0,0,0.18),0_2px_7px_rgba(0,0,0,0.11)]",
          "transition-transform duration-200 ease-out",
          checked ? "translate-x-[16px]" : "translate-x-0",
        )}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

interface GlmSearchSettingsProps {
  searchEngine: string;
  searchIntent: boolean;
  onSearchEngineChange: (value: string) => void;
  onSearchIntentChange: (value: boolean) => void;
}

const GLM_SEARCH_ENGINES = [
  { value: "search_std", key: "settings.values.glmSearchStd", fallback: "Standard" },
  { value: "search_pro", key: "settings.values.glmSearchPro", fallback: "Pro" },
  { value: "search_pro_sogou", key: "settings.values.glmSearchSogou", fallback: "Sogou" },
  { value: "search_pro_quark", key: "settings.values.glmSearchQuark", fallback: "Quark" },
] as const;

export function GlmSearchSettings({
  searchEngine,
  searchIntent,
  onSearchEngineChange,
  onSearchIntentChange,
}: GlmSearchSettingsProps) {
  const { t } = useTranslation();
  const tx = (key: string, fallback: string) => t(key, { defaultValue: fallback });

  return (
    <>
      <SettingsRow
        title={tx("settings.rows.glmSearchEngine", "GLM search engine")}
        description={tx("settings.help.glmSearchEngine", "Which GLM search backend to use.")}
      >
        <select
          value={searchEngine}
          onChange={(event) => onSearchEngineChange(event.target.value)}
          className="h-10 w-[200px] rounded-[12px] border border-input bg-background px-3 text-[13px] text-foreground shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        >
          {GLM_SEARCH_ENGINES.map((engine) => (
            <option key={engine.value} value={engine.value}>
              {tx(engine.key, engine.fallback)}
            </option>
          ))}
        </select>
      </SettingsRow>
      <SettingsRow
        title={tx("settings.rows.glmSearchIntent", "GLM search intent")}
        description={tx("settings.help.glmSearchIntent", "Enable intent recognition before searching.")}
      >
        <ToggleButton
          checked={searchIntent}
          onChange={onSearchIntentChange}
          ariaLabel={tx("settings.rows.glmSearchIntent", "GLM search intent")}
          label={searchIntent ? tx("settings.values.on", "On") : tx("settings.values.off", "Off")}
        />
      </SettingsRow>
    </>
  );
}
