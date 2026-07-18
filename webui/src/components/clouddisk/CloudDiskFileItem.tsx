import { useState } from "react";
import { File, FileText, Image, Video, Folder, Check, Trash2, Pencil, ExternalLink } from "lucide-react";
import type { CloudDiskFileItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CloudDiskFileItemProps {
  file: CloudDiskFileItem;
  viewMode: "list" | "grid";
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function fileIcon(file: CloudDiskFileItem) {
  if (file.type === "directory") return Folder;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) return Image;
  if (["mp4", "webm", "mov"].includes(ext || "")) return Video;
  if (["md", "txt", "json", "csv", "yaml", "yml", "toml"].includes(ext || "")) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CloudDiskFileItemRow({
  file, viewMode, isSelected, onToggleSelect, onOpen, onDelete, onRename,
}: CloudDiskFileItemProps) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const Icon = fileIcon(file);

  const handleRename = () => {
    if (newName && newName !== file.name) {
      onRename(newName);
    }
    setRenaming(false);
  };

  if (viewMode === "grid") {
    return (
      <div
        className={cn(
          "flex flex-col items-center p-2 rounded-lg cursor-pointer border transition-colors",
          isSelected ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent",
        )}
        onClick={file.type === "directory" ? onOpen : onToggleSelect}
        onDoubleClick={file.type === "file" ? onOpen : undefined}
      >
        <Icon className="h-8 w-8 mb-1 text-muted-foreground" />
        {renaming ? (
          <input
            className="w-full text-xs text-center border rounded px-1"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === "Enter") handleRename(); }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="text-xs text-center truncate w-full">{file.name}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
        isSelected ? "bg-primary/10" : "hover:bg-accent",
      )}
      onClick={file.type === "directory" ? onOpen : onToggleSelect}
      onDoubleClick={file.type === "file" ? onOpen : undefined}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            className="w-full text-sm border rounded px-1"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === "Enter") handleRename(); }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="text-sm truncate block">{file.name}</span>
        )}
      </div>
      {file.type === "file" && (
        <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
          {formatSize(file.size)}
        </span>
      )}
      <span className="text-xs text-muted-foreground w-24 text-right shrink-0 hidden md:block">
        {file.created_at ? new Date(file.created_at).toLocaleDateString() : ""}
      </span>
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        {file.type === "file" && (
          <button
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            onClick={onOpen}
            title="Open"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          className="p-1 rounded hover:bg-accent text-muted-foreground"
          onClick={() => { setNewName(file.name); setRenaming(true); }}
          title="Rename"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 text-muted-foreground hover:text-red-600"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
