"use client";

/**
 * app/page.tsx — Main chat interface page.
 *
 * Layout (ChatGPT-inspired):
 *   ┌─────────────────────────────────────────────┐
 *   │  Sidebar (collapsible on mobile)            │
 *   │  ┌──────────────────────────────────────┐  │
 *   │  │  Logo + title                         │  │
 *   │  │  FileUpload component                 │  │
 *   │  │  Ingested doc list                    │  │
 *   │  │  ── divider ──                        │  │
 *   │  │  Dark mode toggle                     │  │
 *   │  │  Clear chat                           │  │
 *   │  └──────────────────────────────────────┘  │
 *   │  Main chat area                             │
 *   │  ┌──────────────────────────────────────┐  │
 *   │  │  Message list (scrollable)            │  │
 *   │  │  Input bar (sticky bottom)            │  │
 *   │  └──────────────────────────────────────┘  │
 *   └─────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Moon,
  PanelLeft,
  Send,
  Square,
  Sun,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";

import { useChat } from "@/hooks/useChat";
import { ChatMessage } from "@/components/ChatMessage";
import { FileUpload } from "@/components/FileUpload";

// ---------------------------------------------------------------------------
// Dark mode toggle hook
// ---------------------------------------------------------------------------

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("rag_theme", next ? "dark" : "light");
    } catch {}
  }, [dark]);

  return { dark, toggle };
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8 select-none">
      <div className="h-16 w-16 rounded-2xl bg-brand-500/10 dark:bg-brand-900/30 flex items-center justify-center">
        <Bot className="h-8 w-8 text-brand-500" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
          RAG Assistant
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-xs">
          Upload documents in the sidebar, then ask questions about them.
          Answers are grounded in your documents with source citations.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {[
          "What are the key findings?",
          "Summarise the main points",
          "What does the document say about…",
        ].map((hint) => (
          <span
            key={hint}
            className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-500 dark:text-slate-400"
          >
            {hint}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const {
    messages,
    isLoading,
    error,
    sendMessage,
    stopStreaming,
    clearChat,
    bottomRef,
  } = useChat();

  const { dark, toggle: toggleDark } = useDarkMode();

  // Input state
  const [query, setQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sidebar collapsed state (persisted in localStorage)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Ingested documents list (shown in sidebar)
  const [ingestedDocs, setIngestedDocs] = useState<
    { documentId: string; fileName: string }[]
  >([]);

  // Auto-resize textarea as user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [query]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Load sidebar preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rag_sidebar");
      if (saved !== null) setSidebarOpen(saved === "1");
    } catch {}
  }, []);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try { localStorage.setItem("rag_sidebar", next ? "1" : "0"); } catch {}
  };

  // Submit handler
  const handleSubmit = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;
    setQuery("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await sendMessage(trimmed);
  }, [query, isLoading, sendMessage]);

  // Keyboard: Enter sends, Shift+Enter newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleIngested = (documentId: string, fileName: string) => {
    setIngestedDocs((prev) => {
      if (prev.some((d) => d.documentId === documentId)) return prev;
      return [...prev, { documentId, fileName }];
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-screen overflow-hidden bg-surface dark:bg-surface-dark">
      {/* ================================================================
          SIDEBAR
      ================================================================ */}
      <aside
        className={clsx(
          "flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-700",
          "bg-sidebar dark:bg-sidebar-dark transition-all duration-200 ease-in-out overflow-hidden",
          sidebarOpen ? "w-72" : "w-0",
        )}
      >
        <div className="flex flex-col h-full min-w-72 p-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-6">
            <div className="h-8 w-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight">
                RAG Assistant
              </h1>
              <p className="text-[10px] text-slate-400">Document Q&amp;A</p>
            </div>
          </div>

          {/* Upload section */}
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Knowledge Base
            </p>
            <FileUpload onIngested={handleIngested} />
          </div>

          {/* Ingested documents list */}
          {ingestedDocs.length > 0 && (
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                Indexed ({ingestedDocs.length})
              </p>
              <ul className="space-y-1">
                {ingestedDocs.map((doc) => (
                  <li
                    key={doc.documentId}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                    <span className="truncate">{doc.fileName}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bottom controls */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 mt-3 space-y-1">
            {/* Dark mode toggle */}
            <button
              onClick={toggleDark}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
            >
              {dark ? (
                <Sun className="h-4 w-4 shrink-0" />
              ) : (
                <Moon className="h-4 w-4 shrink-0" />
              )}
              {dark ? "Light mode" : "Dark mode"}
            </button>

            {/* Clear chat */}
            <button
              onClick={clearChat}
              disabled={messages.length === 0}
              className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-600 dark:disabled:hover:text-slate-300"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              Clear conversation
            </button>
          </div>
        </div>
      </aside>

      {/* ================================================================
          MAIN CONTENT
      ================================================================ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* ---- Top bar ------------------------------------------------ */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
          {/* Sidebar toggle */}
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Chat
          </span>

          {/* Error pill */}
          {error && (
            <span className="ml-auto text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">
              {error}
            </span>
          )}
        </header>

        {/* ---- Message list ------------------------------------------- */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-w-3xl mx-auto py-4">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {/* Sentinel for auto-scroll */}
              <div ref={bottomRef} />
            </div>
          )}
        </main>

        {/* ---- Input bar ---------------------------------------------- */}
        <footer className="shrink-0 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 shadow-sm focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-400 transition-all">
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your documents…"
                rows={1}
                disabled={isLoading && !messages.some((m) => m.streaming)}
                className="flex-1 resize-none bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none leading-relaxed max-h-44 overflow-y-auto scrollbar-hidden disabled:opacity-50"
                aria-label="Message input"
              />

              {/* Send / Stop button */}
              {isLoading ? (
                <button
                  onClick={stopStreaming}
                  title="Stop generating"
                  className="shrink-0 h-8 w-8 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 flex items-center justify-center transition-colors"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!query.trim()}
                  title="Send message (Enter)"
                  className="shrink-0 h-8 w-8 rounded-xl bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[10px] text-slate-400 dark:text-slate-500">
              Shift+Enter for new line · Enter to send
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
