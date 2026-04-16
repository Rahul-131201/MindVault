/**
 * hooks/useChat.ts — React hook for managing the full chat lifecycle.
 *
 * Responsibilities:
 *   - Session ID persistence (localStorage, survives page refresh)
 *   - Message history state (user + assistant turns)
 *   - Streaming token accumulation
 *   - Abort controller (cancel in-flight request)
 *   - Source references state
 *   - Loading / error state
 *   - Automatic scroll-to-bottom ref
 *   - Clear conversation
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  ApiError,
  type ChatMessage,
  type SourceReference,
  streamChat,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  fallback?: boolean;
  /** True while the assistant message is still being streamed */
  streaming?: boolean;
  timestamp: Date;
}

export interface UseChatReturn {
  messages: UIMessage[];
  isLoading: boolean;
  error: string | null;
  sessionId: string;
  sendMessage: (query: string, filters?: Record<string, unknown>) => Promise<void>;
  stopStreaming: () => void;
  clearChat: () => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_KEY = "rag_session_id";
const MAX_HISTORY_TURNS = 10; // keep last N complete user+assistant pairs

// ---------------------------------------------------------------------------
// Helper: convert UIMessages → API ChatMessage history
// ---------------------------------------------------------------------------

function toApiHistory(messages: UIMessage[]): ChatMessage[] {
  // Exclude any still-streaming assistant messages and take the last N pairs
  const completed = messages.filter((m) => !m.streaming);
  const recent = completed.slice(-(MAX_HISTORY_TURNS * 2));
  return recent.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChat(): UseChatReturn {
  // ---- Session ID ---------------------------------------------------------
  const [sessionId] = useState<string>(() => {
    if (typeof window === "undefined") return uuidv4();
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const fresh = uuidv4();
    localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  });

  // ---- State --------------------------------------------------------------
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Refs ---------------------------------------------------------------
  const abortControllerRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // ---- Actions ------------------------------------------------------------

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    // Mark any streaming message as done (keep content accumulated so far)
    setMessages((prev) =>
      prev.map((m) =>
        m.streaming ? { ...m, streaming: false, content: m.content || "_(stopped)_" } : m,
      ),
    );
  }, []);

  const clearChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setMessages([]);
    setError(null);
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(
    async (query: string, filters?: Record<string, unknown>) => {
      const trimmed = query.trim();
      if (!trimmed || isLoading) return;

      setError(null);
      setIsLoading(true);

      // Abort any previous in-flight request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 1. Append user message immediately
      const userMsg: UIMessage = {
        id: uuidv4(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };

      // 2. Create a placeholder assistant message for streaming
      const assistantId = uuidv4();
      const assistantPlaceholder: UIMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);

      try {
        // Build history from messages that exist BEFORE this turn
        const history = toApiHistory(
          // messages state hasn't updated yet — use snapshot
          messages,
        );

        // 3. Stream response
        for await (const chunk of streamChat(
          {
            session_id: sessionId,
            query: trimmed,
            history,
            filters,
            stream: true,
          },
          controller.signal,
        )) {
          if (chunk.error) {
            setError(chunk.error);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: `⚠️ ${chunk.error}`,
                      streaming: false,
                    }
                  : m,
              ),
            );
            break;
          }

          if (chunk.done) {
            // Final chunk — attach sources, mark done
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                      sources: chunk.sources,
                      fallback: chunk.fallback,
                    }
                  : m,
              ),
            );
            break;
          }

          // Accumulate token delta
          if (chunk.delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk.delta }
                  : m,
              ),
            );
          }
        }
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "AbortError" || err.message === "Upload aborted")
        ) {
          // User cancelled — leave message as-is
          return;
        }

        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "An unexpected error occurred.";

        setError(message);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ ${message}`, streaming: false }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoading, sessionId, messages],
  );

  return {
    messages,
    isLoading,
    error,
    sessionId,
    sendMessage,
    stopStreaming,
    clearChat,
    bottomRef,
  };
}
