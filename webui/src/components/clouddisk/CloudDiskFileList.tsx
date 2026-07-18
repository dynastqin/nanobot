import type { CloudDiskFileItem } from "@/lib/types";
import { CloudDiskFileItemRow } from "./CloudDiskFileItem";
import { Grid3X3, List } from "lucide-react";

interface CloudDiskFileListProps {
  files: CloudDiskFileItem[];
  viewMode: "list" | "grid";
  selected: Set<string>;
  onSelect: (sel: Set<string>) => void;
  onOpen: (f: CloudDiskFileItem) => void;
  onDelete: (path: string) => void;
  onRename: (from: string, to: string) => void;
}

export function CloudDiskFileList({
  files, viewMode, selected, onSelect, onOpen, onDelete, onRename,
}: CloudDiskFileListProps) {
  const toggleSelect = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    onSelect(next);
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Empty folder</p>
        <p className="text-xs mt-1">Upload files or create folders to get started</p>
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {files.map(f => (
          <CloudDiskFileItemRow
            key={f.path}
            file={f}
            viewMode="grid"
            isSelected={selected.has(f.path)}
            onToggleSelect={() => toggleSelect(f.path)}
            onOpen={() => onOpen(f)}
            onDelete={() => onDelete(f.path)}
            onRename={(name) => onRename(f.path, f.path.replace(/[^/]+$/, name))}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y">
      {files.map(f => (
        <CloudDiskFileItemRow
          key={f.path}
          file={f}
          viewMode="list"
          isSelected={selected.has(f.path)}
          onToggleSelect={() => toggleSelect(f.path)}
          onOpen={() => onOpen(f)}
          onDelete={() => onDelete(f.path)}
          onRename={(name) => onRename(f.path, f.path.replace(/[^/]+$/, name))}
        />
      ))}
    </div>
  );
}
