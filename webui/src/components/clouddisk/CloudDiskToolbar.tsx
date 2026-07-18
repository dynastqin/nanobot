import { FolderOpen, Grid3X3, List, Trash2, Upload } from "lucide-react";

interface CloudDiskToolbarProps {
  currentFolder: string;
  viewMode: "list" | "grid";
  onViewModeChange: (mode: "list" | "grid") => void;
  onUpload: () => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
}

export function CloudDiskToolbar({
  currentFolder, viewMode, onViewModeChange, onUpload, hasSelection, onDeleteSelected,
}: CloudDiskToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <FolderOpen className="h-4 w-4" />
        <span>/{currentFolder || "CloudDisk"}</span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <button
          className="p-1.5 rounded hover:bg-accent text-muted-foreground"
          onClick={onUpload}
          title="Upload"
        >
          <Upload className="h-4 w-4" />
        </button>
        {hasSelection && (
          <button
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900 text-muted-foreground hover:text-red-600"
            onClick={onDeleteSelected}
            title="Delete selected"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          className={`p-1.5 rounded ${viewMode === "list" ? "bg-accent" : "hover:bg-accent"} text-muted-foreground`}
          onClick={() => onViewModeChange("list")}
          title="List view"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          className={`p-1.5 rounded ${viewMode === "grid" ? "bg-accent" : "hover:bg-accent"} text-muted-foreground`}
          onClick={() => onViewModeChange("grid")}
          title="Grid view"
        >
          <Grid3X3 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
