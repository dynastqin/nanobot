import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceFileNode } from "@/lib/types";

export function isPathUnderDir(dirPath: string, targetPath: string | null): boolean {
  if (!targetPath) return false;
  const normalizedDir = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
  return targetPath.startsWith(normalizedDir);
}

export function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: WorkspaceFileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const isDir = node.type === "directory";
  const hasChildren = isDir && node.children && node.children.length > 0;
  const autoExpand = isDir && hasChildren && isPathUnderDir(node.path, selectedPath);
  const [expanded, setExpanded] = useState(autoExpand);

  useEffect(() => {
    if (isDir && hasChildren && isPathUnderDir(node.path, selectedPath)) {
      setExpanded(true);
    }
  }, [selectedPath, isDir, hasChildren, node.path]);

  return (
    <div>
      <button
        type="button"
        data-file-tree-selected={selectedPath === node.path ? "true" : undefined}
        className={cn(
          "flex items-center w-full gap-1.5 px-3 py-1 text-[12.5px] text-left transition-colors hover:bg-accent/40",
          selectedPath === node.path && "bg-accent/60 text-foreground",
          !selectedPath && "text-foreground/85",
          selectedPath && selectedPath !== node.path && "text-muted-foreground",
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => {
          if (isDir && hasChildren) {
            setExpanded(!expanded);
          } else if (!isDir) {
            onSelect(node.path);
          }
        }}
      >
        {isDir && hasChildren ? (
          <ChevronRight className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            expanded && "rotate-90",
          )} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isDir ? (
          expanded && hasChildren ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
          )
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="truncate">{node.name}</span>
        {!isDir && node.size !== undefined && (
          <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/50">
            {formatSize(node.size)}
          </span>
        )}
      </button>
      {isDir && hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
