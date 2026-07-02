import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AvatarRole = Role;

interface AvatarProps {
  role: AvatarRole;
  size?: number;
  className?: string;
}

const ROLE_STYLES: Record<string, { bg: string; letter: string }> = {
  user: {
    bg: "linear-gradient(135deg, #64748b, #475569)",
    letter: "U",
  },
  assistant: {
    bg: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    letter: "A",
  },
  tool: {
    bg: "linear-gradient(135deg, #0ea5e9, #0284c7)",
    letter: "T",
  },
  system: {
    bg: "linear-gradient(135deg, #a1a1aa, #71717a)",
    letter: "S",
  },
};

/**
 * 32x32 circular initial-letter avatar.
 *
 * User      = grey gradient   + "U"
 * Assistant = purple gradient + "A"
 * Tool      = blue gradient   + "T"
 * System    = zinc gradient   + "S"
 *
 * Purely decorative — role is already implied by message position.
 */
export function Avatar({ role, size = 32, className }: AvatarProps) {
  const style = ROLE_STYLES[role] ?? ROLE_STYLES.assistant;
  const fontSize = Math.round(size * 0.4);
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: style.bg,
        fontSize,
      }}
    >
      {style.letter}
    </div>
  );
}
