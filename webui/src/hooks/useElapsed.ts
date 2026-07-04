import { useEffect, useState } from "react";

/**
 * Returns a live-updating formatted elapsed time string from an ISO timestamp.
 * Updates roughly every second while the timer is running.
 */
export function useElapsed(createdIso?: string, stopped?: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!createdIso || stopped) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [createdIso, stopped]);

  if (!createdIso) return "";

  const ms = Math.max(0, now - new Date(createdIso).getTime());
  const seconds = ms > 0 && ms < 1000 ? 1 : Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}
