/**
 * lib/api.ts — Typed API client for the RAG backend.
 *
 * Exports:
 *   - Types: ChatMessage, SourceReference, StreamChunk, IngestResponse, etc.
 *   - streamChat()   — async generator that yields StreamChunk from SSE
 *   - sendChat()     — batch (non-streaming) chat request
 *   - uploadDocument() — multipart file upload with progress
 *   - getIngestStatus() — poll ingestion job status
 *   - listDocuments()   — list all ingested documents
 */

// ---------------------------------------------------------------------------
// Base URL — reads from Next.js public env var, falls back to localhost
// ---------------------------------------------------------------------------
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Shared types (mirror backend Pydantic schemas)
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp?: string;
}

export interface SourceReference {
  document_id: string;
  file_name: string;
  page?: number | null;
  chunk_index: number;
  score: number;          // 0–1 relevance score after reranking
  excerpt: string;        // short text snippet from the chunk
  metadata: Record<string, unknown>;
}

export interface StreamChunk {
  delta: string;          // incremental token text
  done: boolean;
  sources: SourceReference[];
  fallback: boolean;
  error?: string | null;
}

export interface ChatRequest {
  session_id?: string;
  query: string;
  history: ChatMessage[];
  top_k?: number;
  filters?: Record<string, unknown>;
  stream?: boolean;
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  sources: SourceReference[];
  query_expansions: string[];
  fallback: boolean;
  latency_ms?: number;
}

export type IngestStatus = "pending" | "processing" | "completed" | "failed";

export interface IngestResponse {
  document_id: string;
  file_name: string;
  file_size_bytes: number;
  document_type: string;
  status: IngestStatus;
  chunk_count?: number | null;
  message: string;
  created_at: string;
}

export interface IngestStatusResponse {
  document_id: string;
  file_name: string;
  status: IngestStatus;
  chunk_count?: number | null;
  /** 0-100 indexing progress reported by the backend */
  progress?: number;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface DocumentListResponse {
  count: number;
  documents: Array<{
    document_id: string;
    file_name: string;
    status: IngestStatus;
    chunk_count?: number | null;
    created_at: string;
  }>;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const message =
      typeof detail === "object" && detail !== null && "detail" in detail
        ? String((detail as Record<string, unknown>).detail)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, message, detail);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// SSE streaming chat
// ---------------------------------------------------------------------------

/**
 * Open an SSE stream to POST /api/chat/stream and yield StreamChunk objects.
 *
 * Usage:
 *   for await (const chunk of streamChat(request)) {
 *     if (chunk.done) { setSources(chunk.sources); break; }
 *     setAnswer(prev => prev + chunk.delta);
 *   }
 */
export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail: unknown;
    try { detail = await res.json(); } catch { detail = await res.text(); }
    throw new ApiError(res.status, `Stream failed: HTTP ${res.status}`, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by double newlines
      const frames = buffer.split("\n\n");
      // Keep the last incomplete frame in the buffer
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (!frame.trim()) continue;

        // Extract the data line(s) from the SSE frame
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));

        if (!dataLine) continue;

        const jsonStr = dataLine.slice("data:".length).trim();
        if (!jsonStr) continue;

        try {
          const chunk = JSON.parse(jsonStr) as StreamChunk;
          yield chunk;
          if (chunk.done || chunk.error) return;
        } catch {
          // Malformed JSON — skip this frame
          console.warn("[api] Failed to parse SSE frame:", jsonStr);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Batch (non-streaming) chat
// ---------------------------------------------------------------------------

/**
 * Send a chat request and receive the full response at once.
 * Use this as a fallback for environments that don't support SSE.
 */
export async function sendChat(
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: false }),
    signal,
  });
  return handleResponse<ChatResponse>(res);
}

// ---------------------------------------------------------------------------
// Document ingestion
// ---------------------------------------------------------------------------

/**
 * Upload a file to the RAG backend for ingestion.
 * Returns immediately with a document_id — poll getIngestStatus() for progress.
 */
export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<IngestResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/ingest`);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as IngestResponse);
        } catch {
          reject(new ApiError(xhr.status, "Invalid response from server"));
        }
      } else {
        let detail: unknown;
        try { detail = JSON.parse(xhr.responseText); } catch { detail = xhr.responseText; }
        const msg =
          typeof detail === "object" && detail !== null && "detail" in detail
            ? String((detail as Record<string, unknown>).detail)
            : `Upload failed: HTTP ${xhr.status}`;
        reject(new ApiError(xhr.status, msg, detail));
      }
    });

    xhr.addEventListener("error", () =>
      reject(new ApiError(0, "Network error during upload")),
    );
    xhr.addEventListener("abort", () =>
      reject(new ApiError(0, "Upload aborted")),
    );

    xhr.send(formData);
  });
}

/**
 * Poll the ingestion status of a previously uploaded document.
 */
export async function getIngestStatus(
  documentId: string,
): Promise<IngestStatusResponse> {
  const res = await fetch(`${API_BASE}/api/ingest/${documentId}/status`);
  return handleResponse<IngestStatusResponse>(res);
}

/**
 * List all documents seen in the current server session.
 */
export async function listDocuments(): Promise<DocumentListResponse> {
  const res = await fetch(`${API_BASE}/api/ingest/documents`);
  return handleResponse<DocumentListResponse>(res);
}

/**
 * Clear all stored data (FAISS index, BM25 corpus, uploaded files, and job history).
 * Useful for starting fresh with new documents.
 */
export async function clearData(): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/ingest/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse<{ status: string; message: string }>(res);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse<{ status: string }>(res);
}

// ---------------------------------------------------------------------------
// Utility: poll until ingestion completes or fails
// ---------------------------------------------------------------------------

/**
 * Poll getIngestStatus() every `intervalMs` until status is
 * "completed" or "failed", then resolve/reject accordingly.
 *
 * @param documentId  ID returned by uploadDocument()
 * @param intervalMs  Polling interval in ms (default 1000)
 * @param timeoutMs   Max wait time in ms (default 600 000 = 10 min)
 * @param onProgress  Optional callback receiving 0-100 progress value
 */
export async function waitForIngestion(
  documentId: string,
  intervalMs = 1_000,
  timeoutMs = 600_000,
  onProgress?: (progress: number) => void,
): Promise<IngestStatusResponse> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const statusResp = await getIngestStatus(documentId);

    if (onProgress && statusResp.progress != null) {
      onProgress(statusResp.progress);
    }

    if (statusResp.status === "completed") return statusResp;
    if (statusResp.status === "failed") {
      throw new ApiError(
        500,
        `Ingestion failed: ${statusResp.error ?? "unknown error"}`,
      );
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new ApiError(408, `Ingestion timed out after ${timeoutMs / 1000}s`);
}
