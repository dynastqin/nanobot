import { useCallback, useEffect, useRef, useState } from "react";

import { DOCUMENT_MIMES } from "@/hooks/useAttachedImages";

/** Maximum document attachments per message. */
export const MAX_DOCUMENTS_PER_MESSAGE = 10;

/** Maximum raw file size for a single document (50 MB). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** Lifecycle stages — mirrors ``AttachmentStatus`` from the image hook but
 *  documents never go through a Worker so the only states are ``ready`` and
 *  ``error`` (plus a transient ``encoding`` while ``FileReader`` is running). */
export type DocumentAttachmentStatus = "encoding" | "ready" | "error";

/** Machine-readable rejection reasons for document attachments.
 *
 * Reuses the same token space as image rejections so the Composer can share
 * a single ``imageRejected.*`` i18n table. */
export type DocumentAttachmentError =
  | "unsupported_type"
  | "too_many_images" // reuse key — i18n message is generic "files"
  | "too_large"
  | "io";

export interface AttachedDocument {
  id: string;
  file: File;
  /** ``blob:`` URL used only for the chip's size/filename display — documents
   *  don't render a visual preview. Revoked on ``remove`` / ``clear``. */
  previewUrl: string;
  status: DocumentAttachmentStatus;
  /** ``data:<mime>;base64,...`` payload populated when ``status === "ready"``. */
  dataUrl?: string;
  /** Human-readable error when ``status === "error"``. */
  error?: DocumentAttachmentError;
}

export interface UseDocumentsApi {
  documents: AttachedDocument[];
  /** Enqueue new document files. Returns rejected files so the caller can
   *  surface inline errors. */
  enqueue: (files: Iterable<File>) => {
    rejected: Array<{ file: File; reason: DocumentAttachmentError }>;
  };
  remove: (id: string) => { nextFocusId: string | null };
  clear: () => void;
  /** ``true`` when at least one document is still being read. */
  encoding: boolean;
  /** ``true`` when ``documents.length >= MAX_DOCUMENTS_PER_MESSAGE``. */
  full: boolean;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Manage the lifecycle of document attachments in the Composer.
 *
 * Mirrors ``useAttachedImages`` but uses ``FileReader.readAsDataURL()`` to
 * produce a base64 ``data:`` URL directly — documents don't need canvas
 * normalization so the Worker path is unnecessary.
 */
export function useDocuments(): UseDocumentsApi {
  const [documents, setDocuments] = useState<AttachedDocument[]>([]);
  // Ref mirror — same rationale as ``useAttachedImages``: ``enqueue`` may be
  // called multiple times in one tick and needs the authoritative length.
  const docsRef = useRef<AttachedDocument[]>([]);
  docsRef.current = documents;

  const setEntry = useCallback(
    (id: string, patch: Partial<AttachedDocument>) => {
      setDocuments((prev) => {
        const next = prev.map((doc) =>
          doc.id === id ? { ...doc, ...patch } : doc,
        );
        docsRef.current = next;
        return next;
      });
    },
    [],
  );

  const enqueue = useCallback(
    (files: Iterable<File>) => {
      const rejected: Array<{ file: File; reason: DocumentAttachmentError }> = [];
      const toAdd: AttachedDocument[] = [];
      let slot = MAX_DOCUMENTS_PER_MESSAGE - docsRef.current.length;

      for (const file of files) {
        if (!DOCUMENT_MIMES.has(file.type)) {
          rejected.push({ file, reason: "unsupported_type" });
          continue;
        }
        if (file.size > MAX_DOCUMENT_BYTES) {
          rejected.push({ file, reason: "too_large" });
          continue;
        }
        if (slot <= 0) {
          rejected.push({ file, reason: "too_many_images" });
          continue;
        }
        slot -= 1;
        toAdd.push({
          id: uuid(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: "encoding",
        });
      }

      if (toAdd.length > 0) {
        const next = [...docsRef.current, ...toAdd];
        docsRef.current = next;
        setDocuments(next);

        for (const entry of toAdd) {
          queueMicrotask(() => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result === "string" && result.startsWith("data:")) {
                setEntry(entry.id, { status: "ready", dataUrl: result });
              } else {
                setEntry(entry.id, { status: "error", error: "io" });
              }
            };
            reader.onerror = () => {
              setEntry(entry.id, { status: "error", error: "io" });
            };
            reader.readAsDataURL(entry.file);
          });
        }
      }
      return { rejected };
    },
    [setEntry],
  );

  const remove = useCallback((id: string) => {
    let nextFocusId: string | null = null;
    setDocuments((prev) => {
      const idx = prev.findIndex((doc) => doc.id === id);
      if (idx === -1) return prev;
      const target = prev[idx];
      try {
        URL.revokeObjectURL(target.previewUrl);
      } catch {
        // best-effort
      }
      const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      docsRef.current = next;
      const candidate = next[idx] ?? next[idx - 1];
      nextFocusId = candidate?.id ?? null;
      return next;
    });
    return { nextFocusId };
  }, []);

  const clear = useCallback(() => {
    setDocuments((prev) => {
      for (const doc of prev) {
        try {
          URL.revokeObjectURL(doc.previewUrl);
        } catch {
          // best-effort
        }
      }
      docsRef.current = [];
      return [];
    });
  }, []);

  // Revoke any outstanding blob URLs on unmount.
  useEffect(() => {
    return () => {
      for (const doc of docsRef.current) {
        try {
          URL.revokeObjectURL(doc.previewUrl);
        } catch {
          // best-effort cleanup
        }
      }
    };
  }, []);

  const encoding = documents.some((doc) => doc.status === "encoding");
  const full = documents.length >= MAX_DOCUMENTS_PER_MESSAGE;

  return { documents, enqueue, remove, clear, encoding, full };
}
