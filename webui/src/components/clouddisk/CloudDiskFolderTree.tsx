import { Folder, FolderOpen } from "lucide-react";
import type { CloudDiskFileItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CloudDiskFolderTreeProps {
  files: CloudDiskFileItem[];
  currentFolder: string;
  onSelect: (folder: string) => void;
}

export function CloudDiskFolderTree({ files, currentFolder, onSelect }: CloudDiskFolderTreeProps) {
  const folders = files.filter(f => f.type === "directory");

  return (
    <div className="p-2 space-y-0.5">
      <FolderTreeItem
        name="CloudDisk"
        path=""
        isActive={currentFolder === ""}
        onSelect={() => onSelect("")}
      />
      {folders.map(f => (
        <FolderTreeItem
          key={f.path}
          name={f.name}
          path={f.path}
          isActive={currentFolder === f.path}
          onSelect={() => onSelect(f.path)}
        />
      ))}
    </div>
  );
}

function FolderTreeItem({
  name, path, isActive, onSelect,
}: {
  name: string; path: string; isActive: boolean; onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left transition-colors",
        isActive
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={onSelect}
    >
      {isActive ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
      <span className="truncate">{name}</span>
    </button>
  );
}
