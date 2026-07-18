import { useCallback, useEffect, useState } from "react";
import { Folder, FolderOpen, File, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useClient } from "@/providers/ClientProvider";
import { fetchCloudDiskList, fetchCloudDiskInfo } from "@/lib/api";
import type { CloudDiskFileItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FileSelectorModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (file: CloudDiskFileItem, content?: string) => void;
}

export function FileSelectorModal({ open, onClose, onSelect }: FileSelectorModalProps) {
  const { t } = useTranslation();
  const { token } = useClient();
  const [currentFolder, setCurrentFolder] = useState("");
  const [files, setFiles] = useState<CloudDiskFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selFile, setSelFile] = useState<CloudDiskFileItem | null>(null);

  const loadFolder = useCallback(async (folder: string) => {
    setLoading(true);
    try {
      const data = await fetchCloudDiskList(token, folder);
      setFiles(data.files);
      setCurrentFolder(folder);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) loadFolder("");
  }, [open, loadFolder]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!selFile) return;
    if (selFile.size > 0 && selFile.size < 100 * 1024) {
      // Small file: inject content
      try {
        const info = await fetchCloudDiskInfo(token, selFile.path);
        const content = (info as any)?.content;
        onSelect(selFile, typeof content === "string" ? content : undefined);
      } catch {
        onSelect(selFile);
      }
    } else {
      // Large file: reference only
      onSelect(selFile);
    }
    onClose();
  };

  const folders = files.filter(f => f.type === "directory");
  const fileItems = files.filter(f => f.type === "file");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg w-[480px] max-h-[600px] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Select from CloudDisk</h3>
          <button className="p-1 rounded hover:bg-accent" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        {currentFolder && (
          <div className="px-4 py-2 border-b flex items-center gap-2 text-sm">
            <button
              className="text-primary hover:underline"
              onClick={() => loadFolder("")}
            >
              CloudDisk
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">{currentFolder}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading...
            </div>
          ) : (
            <>
              {folders.map(f => (
                <button
                  key={f.path}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded hover:bg-accent text-sm text-left"
                  onClick={() => loadFolder(f.path)}
                >
                  <Folder className="h-4 w-4 text-blue-500" />
                  {f.name}
                </button>
              ))}
              {fileItems.map(f => (
                <button
                  key={f.path}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-left transition-colors",
                    selFile?.path === f.path
                      ? "bg-primary/10 text-primary font-medium"
                      : "hover:bg-accent",
                  )}
                  onClick={() => setSelFile(f)}
                >
                  <File className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{f.name}</span>
                  {f.size > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(0)}KB`}
                    </span>
                  )}
                </button>
              ))}
              {folders.length === 0 && fileItems.length === 0 && (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  Empty folder
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t">
          <span className="text-xs text-muted-foreground">
            {selFile ? selFile.name : "No file selected"}
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 text-sm rounded border hover:bg-accent"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={handleConfirm}
              disabled={!selFile}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
