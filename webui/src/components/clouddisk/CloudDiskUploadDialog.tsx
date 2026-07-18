import { useRef, useState } from "react";
import { Upload, X } from "lucide-react";

interface CloudDiskUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
}

export function CloudDiskUploadDialog({ open, onClose, onUpload }: CloudDiskUploadDialogProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      await onUpload(file);
      onClose();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-lg w-96 p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Upload to CloudDisk</h3>
          <button className="p-1 rounded hover:bg-accent" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-1">
            {uploading ? "Uploading..." : "Drag and drop a file, or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground">Max 100MB per file</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded border hover:bg-accent"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            Browse Files
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
    </div>
  );
}
