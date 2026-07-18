import { HardDrive } from "lucide-react";

interface CloudDiskQuotaBarProps {
  usedMb: number;
  quotaMb: number;
}

export function CloudDiskQuotaBar({ usedMb, quotaMb }: CloudDiskQuotaBarProps) {
  const percent = Math.min((usedMb / quotaMb) * 100, 100);
  const isNearLimit = percent > 85;
  const isOver = percent >= 100;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b text-xs">
      <HardDrive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isOver ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-primary"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={`shrink-0 ${isNearLimit ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
        {usedMb.toFixed(0)} / {quotaMb} MB
        {isOver && " (quota exceeded)"}
      </span>
    </div>
  );
}
