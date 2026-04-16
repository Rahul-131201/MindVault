"use client";

/**
 * components/FileUpload.tsx
 *
 * Drag-and-drop / click-to-browse file upload panel.
 *
 * Features:
 *   - Drag-and-drop with visual feedback
 *   - Click-to-browse fallback
 *   - Upload progress bar (XHR)
 *   - Automatic status polling after upload (waitForIngestion)
 *   - Per-file status: uploading → processing → completed / failed
 *   - Multi-file queue (sequential upload)
 *   - File type + size validation client-side before sending
 *   - Dark mode compatible
 */

import { useCallback, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { ApiError, uploadDocument, waitForIngestion, clearData } from "@/lib/api";

// ---------------------------------------------------------------------------
// Constants (must match backend settings)
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [".pdf", ".txt", ".docx"];
const ACCEPTED_MIME = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_SIZE_MB = 50;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileStatus = "pending" | "uploading" | "processing" | "completed" | "failed";

interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;        // 0-100 upload progress
  error?: string;
  chunkCount?: number;
  documentId?: string;
}

interface FileUploadProps {
  /** Called after a file finishes ingestion successfully */
  onIngested?: (documentId: string, fileName: string) => void;
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
      <div
        className="h-full rounded-full bg-brand-500 transition-all duration-200"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single file row
// ---------------------------------------------------------------------------

function FileRow({
  entry,
  onRemove,
}: {
  entry: FileEntry;
  onRemove: (id: string) => void;
}) {
  const icon = {
    pending:    <FileText className="h-4 w-4 text-slate-400" />,
    uploading:  <Loader2 className="h-4 w-4 text-brand-500 animate-spin" />,
    processing: <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />,
    completed:  <CheckCircle2 className="h-4 w-4 text-green-500" />,
    failed:     <XCircle className="h-4 w-4 text-red-500" />,
  }[entry.status];

  const label = {
    pending:    "Queued",
    uploading:  `Uploading ${entry.progress}%`,
    processing: entry.progress > 0 ? `Indexing… ${entry.progress}%` : "Indexing…",
    completed:  entry.chunkCount ? `Done · ${entry.chunkCount} chunks` : "Done",
    failed:     entry.error ?? "Failed",
  }[entry.status];

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium text-slate-700 dark:text-slate-200">
          {entry.file.name}
        </p>
        <p
          className={clsx("mt-0.5", {
            "text-slate-400":  ["pending", "uploading", "processing"].includes(entry.status),
            "text-green-600 dark:text-green-400": entry.status === "completed",
            "text-red-500":   entry.status === "failed",
          })}
        >
          {label}
        </p>
        {(entry.status === "uploading" || entry.status === "processing") && (
          <div className="mt-1">
            <ProgressBar value={entry.progress} />
          </div>
        )}
      </div>
      {/* Remove button — only when not actively uploading */}
      {entry.status !== "uploading" && entry.status !== "processing" && (
        <button
          onClick={() => onRemove(entry.id)}
          className="shrink-0 p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          aria-label="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FileUpload({ onIngested }: FileUploadProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadQueueRef = useRef<Set<string>>(new Set());

  // ---- Helpers ------------------------------------------------------------

  const updateEntry = useCallback(
    (id: string, patch: Partial<FileEntry>) => {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      );
    },
    [],
  );

  const removeEntry = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ---- Clear data handler -------------------------------------------------

  const handleClear = useCallback(async () => {
    if (isClearing) return;
    
    const confirmed = window.confirm(
      "Are you sure you want to clear all stored data?\n\n" +
      "This will delete:\n" +
      "- FAISS vector store index\n" +
      "- All indexed documents\n" +
      "- Upload history\n\n" +
      "This action cannot be undone."
    );
    
    if (!confirmed) return;

    setIsClearing(true);
    setClearError(null);

    try {
      await clearData();
      // Clear the file list and show success
      setFiles([]);
      // Show confirmation message for a moment
      setTimeout(() => {
        setClearError(null);
      }, 3000);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to clear data";
      setClearError(msg);
    } finally {
      setIsClearing(false);
    }
  }, [isClearing]);

  // ---- Validation ---------------------------------------------------------

  function validateFile(file: File): string | null {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_TYPES.includes(ext)) {
      return `Unsupported type "${ext}". Allowed: ${ACCEPTED_TYPES.join(", ")}`;
    }
    if (file.size > MAX_SIZE_BYTES) {
      return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_SIZE_MB} MB`;
    }
    return null;
  }

  // ---- Upload pipeline ----------------------------------------------------

  async function processFile(entry: FileEntry) {
    if (uploadQueueRef.current.has(entry.id)) return;
    uploadQueueRef.current.add(entry.id);

    try {
      // 1. Upload
      updateEntry(entry.id, { status: "uploading", progress: 0 });

      const ingestResp = await uploadDocument(entry.file, (pct) => {
        updateEntry(entry.id, { progress: pct });
      });

      // 2. Poll for indexing completion — show backend progress 0-100
      updateEntry(entry.id, {
        status: "processing",
        documentId: ingestResp.document_id,
        progress: 0,
      });

      const finalStatus = await waitForIngestion(
        ingestResp.document_id,
        1_000,   // poll every 1 s
        600_000, // 10 min max
        (backendProgress) => {
          updateEntry(entry.id, { progress: backendProgress });
        },
      );

      updateEntry(entry.id, {
        status: "completed",
        chunkCount: finalStatus.chunk_count ?? undefined,
      });

      onIngested?.(ingestResp.document_id, entry.file.name);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed";
      updateEntry(entry.id, { status: "failed", error: msg });
    } finally {
      uploadQueueRef.current.delete(entry.id);
    }
  }

  // ---- File intake --------------------------------------------------------

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    const newEntries: FileEntry[] = [];

    for (const file of arr) {
      const error = validateFile(file);
      const id = crypto.randomUUID();
      const entry: FileEntry = {
        id,
        file,
        status: error ? "failed" : "pending",
        progress: 0,
        error: error ?? undefined,
      };
      newEntries.push(entry);
    }

    setFiles((prev) => [...prev, ...newEntries]);

    // Start upload for valid files
    for (const entry of newEntries) {
      if (entry.status === "pending") {
        processFile(entry);
      }
    }
  }

  // ---- Drag and drop handlers --------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addFiles(e.target.files);
        // Reset so the same file can be re-uploaded after a failure
        e.target.value = "";
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ---- Render -------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* Clear data button + error message */}
      {files.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={isClearing}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium",
              "transition-colors duration-150",
              isClearing
                ? "bg-red-100 dark:bg-red-900/30 text-red-400 cursor-not-allowed"
                : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
              !isClearing && "hover:bg-red-100 dark:hover:bg-red-900/30 active:bg-red-200 dark:active:bg-red-900/40",
            )}
            aria-label="Clear all stored data"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", isClearing && "animate-spin")} />
            <span>{isClearing ? "Clearing..." : "Clear Data"}</span>
          </button>
          {clearError && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {clearError}
            </span>
          )}
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={clsx(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed",
          "cursor-pointer select-none transition-colors duration-150",
          "px-4 py-6 text-center",
          isDragging
            ? "border-brand-500 bg-brand-50 dark:bg-brand-900/20"
            : "border-slate-300 dark:border-slate-600 hover:border-brand-400 hover:bg-slate-50 dark:hover:bg-slate-800/50",
        )}
      >
        <Upload
          className={clsx(
            "h-7 w-7 transition-colors",
            isDragging ? "text-brand-500" : "text-slate-400",
          )}
        />
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            {isDragging ? "Drop files here" : "Drag & drop or click to upload"}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            PDF, TXT, DOCX · Max {MAX_SIZE_MB} MB each
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          className="sr-only"
          onChange={handleInputChange}
          tabIndex={-1}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
          {files.map((entry) => (
            <FileRow key={entry.id} entry={entry} onRemove={removeEntry} />
          ))}
        </div>
      )}
    </div>
  );
}

export default FileUpload;
