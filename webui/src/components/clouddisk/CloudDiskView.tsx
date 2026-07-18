import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useClient } from "@/providers/ClientProvider";
import {
  deleteCloudDiskFile,
  fetchCloudDiskList,
  fetchCloudDiskQuota,
  moveCloudDiskFile,
  uploadCloudDiskFile,
} from "@/lib/api";
import type { CloudDiskFileItem, CloudDiskQuotaPayload } from "@/lib/types";
import { CloudDiskFolderTree } from "./CloudDiskFolderTree";
import { CloudDiskFileList } from "./CloudDiskFileList";
import { CloudDiskQuotaBar } from "./CloudDiskQuotaBar";
import { CloudDiskToolbar } from "./CloudDiskToolbar";
import { CloudDiskUploadDialog } from "./CloudDiskUploadDialog";

export function CloudDiskView() {
  const { t } = useTranslation();
  const { token } = useClient();
  const [currentFolder, setCurrentFolder] = useState("");
  const [files, setFiles] = useState<CloudDiskFileItem[]>([]);
  const [quota, setQuota] = useState<CloudDiskQuotaPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [uploadOpen, setUploadOpen] = useState(false);

  const loadFolder = useCallback(async (folder: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCloudDiskList(token, folder);
      setFiles(data.files);
      setCurrentFolder(folder);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadQuota = useCallback(async () => {
    try {
      const q = await fetchCloudDiskQuota(token);
      setQuota(q);
    } catch {
      // quota fetch is non-critical
    }
  }, [token]);

  useEffect(() => {
    loadFolder("");
    loadQuota();
  }, [loadFolder, loadQuota]);

  const handleDelete = useCallback(async (path: string) => {
    try {
      await deleteCloudDiskFile(token, path);
      loadFolder(currentFolder);
      loadQuota();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [token, currentFolder, loadFolder, loadQuota]);

  const handleRename = useCallback(async (from: string, to: string) => {
    try {
      await moveCloudDiskFile(token, from, to);
      loadFolder(currentFolder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }, [token, currentFolder, loadFolder]);

  const handleUpload = useCallback(async (file: File) => {
    try {
      await uploadCloudDiskFile(token, currentFolder, file.name, file);
      loadFolder(currentFolder);
      loadQuota();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }, [token, currentFolder, loadFolder, loadQuota]);

  return (
    <div className="flex flex-col h-full">
      {quota && <CloudDiskQuotaBar usedMb={quota.used_mb} quotaMb={quota.quota_mb} />}
      <CloudDiskToolbar
        currentFolder={currentFolder}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onUpload={() => setUploadOpen(true)}
        hasSelection={selected.size > 0}
        onDeleteSelected={() => {
          selected.forEach(p => handleDelete(p));
        }}
      />
      {error && (
        <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 border-r overflow-y-auto shrink-0">
          <CloudDiskFolderTree
            files={files}
            currentFolder={currentFolder}
            onSelect={loadFolder}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              Loading...
            </div>
          ) : (
            <CloudDiskFileList
              files={files}
              viewMode={viewMode}
              selected={selected}
              onSelect={setSelected}
              onOpen={(f) => {
                if (f.type === "directory") {
                  loadFolder(f.path);
                }
              }}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          )}
        </div>
      </div>
      {uploadOpen && (
        <CloudDiskUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
}
