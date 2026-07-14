import { useEffect, useMemo, useState } from "react";

import { logoFallbackUrls } from "@/lib/provider-brand";
import type { CliAppInfo, McpPresetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type CliAppMentionSegment =
  | { kind: "text"; text: string }
  | { kind: "cli"; text: string; app: CliAppInfo };

export type CapabilityMentionSegment =
  | CliAppMentionSegment
  | { kind: "mcp"; text: string; preset: McpPresetInfo }
  | { kind: "skill"; text: string; name: string }
  | { kind: "command"; text: string; name: string };

export function cliAppInitials(app: CliAppInfo): string {
  const value = app.display_name || app.name;
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || app.name.slice(0, 2).toUpperCase()
  );
}

export function mcpPresetInitials(preset: Pick<McpPresetInfo, "name" | "display_name">): string {
  const value = preset.display_name || preset.name;
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || preset.name.slice(0, 2).toUpperCase()
  );
}

export function splitCliAppMentionSegments(
  value: string,
  cliApps: CliAppInfo[],
): CliAppMentionSegment[] {
  if (!value || cliApps.length === 0) return value ? [{ kind: "text", text: value }] : [];
  const appsByName = new Map(
    cliApps
      .filter((app) => app.installed)
      .map((app) => [app.name.toLowerCase(), app]),
  );
  if (appsByName.size === 0) return [{ kind: "text", text: value }];

  const segments: CliAppMentionSegment[] = [];
  const mentionRe = /(^|[\s([{])@([a-z0-9_-]+)\b/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(value)) !== null) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const app = appsByName.get(name.toLowerCase());
    if (!app) continue;

    const mentionStart = match.index + prefix.length;
    const mentionEnd = mentionStart + name.length + 1;
    if (mentionStart > cursor) {
      segments.push({ kind: "text", text: value.slice(cursor, mentionStart) });
    }
    segments.push({ kind: "cli", text: value.slice(mentionStart, mentionEnd), app });
    cursor = mentionEnd;
  }
  if (cursor < value.length) {
    segments.push({ kind: "text", text: value.slice(cursor) });
  }
  return segments.length ? segments : [{ kind: "text", text: value }];
}

export function splitCapabilityMentionSegments(
  value: string,
  cliApps: CliAppInfo[],
  mcpPresets: McpPresetInfo[] = [],
  skillNames: string[] = [],
  slashCommandNames: string[] = [],
): CapabilityMentionSegment[] {
  if (
    !value ||
    (cliApps.length === 0 &&
      mcpPresets.length === 0 &&
      skillNames.length === 0 &&
      slashCommandNames.length === 0)
  ) {
    return value ? [{ kind: "text", text: value }] : [];
  }
  const cliAppsByName = new Map(
    cliApps
      .filter((app) => app.installed)
      .map((app) => [app.name.toLowerCase(), app]),
  );
  const mcpPresetsByName = new Map(
    mcpPresets
      .filter((preset) => preset.installed && preset.configured)
      .map((preset) => [preset.name.toLowerCase(), preset]),
  );
  const skillNameSet = new Set(skillNames.map((n) => n.toLowerCase()));
  const slashCommandNameSet = new Set(
    slashCommandNames.map((n) => n.replace(/^\//, "").toLowerCase()),
  );
  if (
    cliAppsByName.size === 0 &&
    mcpPresetsByName.size === 0 &&
    skillNameSet.size === 0 &&
    slashCommandNameSet.size === 0
  ) {
    return [{ kind: "text", text: value }];
  }

  const segments: CapabilityMentionSegment[] = [];
  const mentionRe = /(^|[\s([{])[@$/]([a-z0-9_-]+)\b/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(value)) !== null) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const key = name.toLowerCase();
    const delimiter = value[match.index + prefix.length];
    if (delimiter === "@") {
      const app = cliAppsByName.get(key);
      const preset = app ? null : mcpPresetsByName.get(key);
      if (!app && !preset) continue;

      const mentionStart = match.index + prefix.length;
      const mentionEnd = mentionStart + name.length + 1;
      if (mentionStart > cursor) {
        segments.push({ kind: "text", text: value.slice(cursor, mentionStart) });
      }
      if (app) {
        segments.push({ kind: "cli", text: value.slice(mentionStart, mentionEnd), app });
      } else if (preset) {
        segments.push({ kind: "mcp", text: value.slice(mentionStart, mentionEnd), preset });
      }
      cursor = mentionEnd;
    } else if (delimiter === "$") {
      if (!skillNameSet.has(key)) continue;

      const mentionStart = match.index + prefix.length;
      const mentionEnd = mentionStart + name.length + 1;
      if (mentionStart > cursor) {
        segments.push({ kind: "text", text: value.slice(cursor, mentionStart) });
      }
      segments.push({
        kind: "skill",
        text: value.slice(mentionStart, mentionEnd),
        name: key,
      });
      cursor = mentionEnd;
    } else if (delimiter === "/") {
      if (!slashCommandNameSet.has(key)) continue;

      const mentionStart = match.index + prefix.length;
      const mentionEnd = mentionStart + name.length + 1;
      if (mentionStart > cursor) {
        segments.push({ kind: "text", text: value.slice(cursor, mentionStart) });
      }
      segments.push({
        kind: "command",
        text: value.slice(mentionStart, mentionEnd),
        name: key,
      });
      cursor = mentionEnd;
    }
  }
  if (cursor < value.length) {
    segments.push({ kind: "text", text: value.slice(cursor) });
  }
  return segments.length ? segments : [{ kind: "text", text: value }];
}

export function CliAppMentionText({
  text,
  cliApps,
  mcpPresets = [],
  skillNames = [],
  slashCommandNames = [],
}: {
  text: string;
  cliApps: CliAppInfo[];
  mcpPresets?: McpPresetInfo[];
  skillNames?: string[];
  slashCommandNames?: string[];
}) {
  const segments = splitCapabilityMentionSegments(
    text,
    cliApps,
    mcpPresets,
    skillNames,
    slashCommandNames,
  );
  if (!segments.some((segment) => segment.kind !== "text")) return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={`text-${index}`}>{segment.text}</span>;
        }
        if (segment.kind === "cli") return (
          <CliAppMentionToken
            key={`cli-${segment.app.name}-${index}`}
            app={segment.app}
            label={segment.text}
            variant="message"
          />
        );
        if (segment.kind === "mcp") return (
          <McpPresetMentionToken
            key={`mcp-${segment.preset.name}-${index}`}
            preset={segment.preset}
            label={segment.text}
            variant="message"
          />
        );
        if (segment.kind === "command") return (
          <CommandMentionToken
            key={`command-${segment.name}-${index}`}
            label={segment.text}
            variant="message"
          />
        );
        return (
          <SkillMentionToken
            key={`skill-${segment.name}-${index}`}
            label={segment.text}
            variant="message"
          />
        );
      })}
    </>
  );
}

export function CliAppMentionToken({
  app,
  label,
  variant,
  isHero = false,
}: {
  app: CliAppInfo;
  label: string;
  variant: "composer" | "message";
  isHero?: boolean;
}) {
  const [logoIndex, setLogoIndex] = useState(0);
  const color = app.brand_color || "hsl(var(--primary))";
  const mentionName = label.startsWith("@") ? label.slice(1) : label;
  const logoUrls = useMemo(() => logoFallbackUrls(app.logo_url), [app.logo_url]);
  const logoUrl = logoUrls[logoIndex];
  const showLogo = Boolean(logoUrl);
  const testIdPrefix = variant === "composer" ? "composer" : "message";

  useEffect(() => setLogoIndex(0), [app.logo_url]);

  return (
    <span
      data-testid={`${testIdPrefix}-cli-mention-${app.name}`}
      title={`CLI app: ${app.display_name || app.name}`}
      className="relative inline transition-[color,text-shadow] duration-150"
      style={{
        color,
        textShadow: `0 0 10px ${alphaColor(color, 24)}`,
      }}
    >
      <span
        className={cn("relative inline-block", showLogo && "text-transparent")}
        style={{ lineHeight: "inherit" }}
      >
        @
        {showLogo ? (
          <span
            data-testid={`${testIdPrefix}-cli-mention-logo-${app.name}`}
            className={cn(
              "absolute left-1/2 top-1/2 grid place-items-center overflow-hidden rounded-[3px]",
              "-translate-x-1/2 -translate-y-1/2",
              isHero ? "h-[0.74em] w-[0.74em]" : "h-[0.72em] w-[0.72em]",
            )}
          >
            <img
              src={logoUrl ?? ""}
              alt=""
              className="h-full w-full object-contain"
              onError={() => setLogoIndex((index) => index + 1)}
            />
          </span>
        ) : null}
      </span>
      {mentionName}
    </span>
  );
}

export function McpPresetMentionToken({
  preset,
  label,
  variant,
  isHero = false,
}: {
  preset: McpPresetInfo;
  label: string;
  variant: "composer" | "message";
  isHero?: boolean;
}) {
  const [logoIndex, setLogoIndex] = useState(0);
  const color = preset.brand_color || "hsl(var(--primary))";
  const mentionName = label.startsWith("@") ? label.slice(1) : label;
  const logoUrls = useMemo(() => logoFallbackUrls(preset.logo_url), [preset.logo_url]);
  const logoUrl = logoUrls[logoIndex];
  const showLogo = Boolean(logoUrl);
  const testIdPrefix = variant === "composer" ? "composer" : "message";

  useEffect(() => setLogoIndex(0), [preset.logo_url]);

  return (
    <span
      data-testid={`${testIdPrefix}-mcp-mention-${preset.name}`}
      title={`MCP server: ${preset.display_name || preset.name}`}
      className="relative inline transition-[color,text-shadow] duration-150"
      style={{
        color,
        textShadow: `0 0 10px ${alphaColor(color, 24)}`,
      }}
    >
      <span
        className={cn("relative inline-block", showLogo && "text-transparent")}
        style={{ lineHeight: "inherit" }}
      >
        @
        {showLogo ? (
          <span
            data-testid={`${testIdPrefix}-mcp-mention-logo-${preset.name}`}
            className={cn(
              "absolute left-1/2 top-1/2 grid place-items-center overflow-hidden rounded-[3px]",
              "-translate-x-1/2 -translate-y-1/2",
              isHero ? "h-[0.74em] w-[0.74em]" : "h-[0.72em] w-[0.72em]",
            )}
          >
            <img
              src={logoUrl ?? ""}
              alt=""
              className="h-full w-full object-contain"
              onError={() => setLogoIndex((index) => index + 1)}
            />
          </span>
        ) : null}
      </span>
      {mentionName}
    </span>
  );
}

export function SkillMentionToken({
  label,
  variant,
  isHero: _isHero = false,
}: {
  label: string;
  variant: "composer" | "message";
  isHero?: boolean;
}) {
  const color = "rgb(251, 143, 60)";
  const mentionName = label.startsWith("$") ? label.slice(1) : label;
  const testIdPrefix = variant === "composer" ? "composer" : "message";

  return (
    <span
      data-testid={`${testIdPrefix}-skill-mention-${mentionName}`}
      title={`Skill: ${mentionName}`}
      className="relative inline transition-[color,text-shadow] duration-150"
      style={{
        color,
        textShadow: `0 0 10px ${alphaColor(color, 24)}`,
      }}
    >
      <span
        className="relative inline-block"
        style={{ lineHeight: "inherit" }}
      >
        $
      </span>
      {mentionName}
    </span>
  );
}

export function CommandMentionToken({
  label,
  variant,
  isHero: _isHero = false,
}: {
  label: string;
  variant: "composer" | "message";
  isHero?: boolean;
}) {
  const color = "rgb(56, 189, 248)";
  const mentionName = label.startsWith("/") ? label.slice(1) : label;
  const testIdPrefix = variant === "composer" ? "composer" : "message";

  return (
    <span
      data-testid={`${testIdPrefix}-command-mention-${mentionName}`}
      title={`Command: /${mentionName}`}
      className="relative inline transition-[color,text-shadow] duration-150"
      style={{
        color,
        textShadow: `0 0 10px ${alphaColor(color, 24)}`,
      }}
    >
      <span
        className="relative inline-block"
        style={{ lineHeight: "inherit" }}
      >
        /
      </span>
      {mentionName}
    </span>
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
