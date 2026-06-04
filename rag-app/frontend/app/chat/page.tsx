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
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
          MindVault Intelligence
        </h2>
        <p className="mt-2 text-[15px] text-slate-600 max-w-md leading-relaxed font-medium">
          Upload your document corpus to the vault. Extract deep insights, synthesize complex data, and query your knowledge base—all grounded in verified citations.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {[
          "Synthesize the core arguments",
          "Extract key actionable insights",
          "Cross-reference findings regarding...",
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
    scrollRef,
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
    <div className="flex h-screen overflow-hidden bg-transparent">
      {/* ================================================================
          SIDEBAR
      ================================================================ */}
      <aside
        className={clsx(
          "flex-shrink-0 flex flex-col border-r border-white/40",
          "bg-white/30 backdrop-blur-[20px] shadow-[4px_0_32px_0_rgba(31,38,135,0.05)] transition-all duration-300 ease-in-out overflow-hidden z-10",
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
              <h1 className="text-[15px] font-extrabold text-slate-900 tracking-wide uppercase leading-tight">
                MindVault
              </h1>
              <p className="text-[11px] font-bold text-blue-600 uppercase tracking-widest mt-0.5">Enterprise AI</p>
            </div>
          </div>

          {/* Upload section */}
          <div className="mb-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">
              Document Corpus
            </p>
            <FileUpload onIngested={handleIngested} />
          </div>

          {/* Ingested documents list */}
          {ingestedDocs.length > 0 && (
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3 mt-4">
                Active Context ({ingestedDocs.length})
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
          <div className="border-t border-white/30 pt-4 mt-4 space-y-2">
            {/* Clear chat */}
            <button
              onClick={clearChat}
              disabled={messages.length === 0}
              className="w-full flex items-center justify-center gap-2.5 rounded-xl px-4 py-3 text-[13px] font-bold text-slate-600 bg-white/40 hover:bg-white/70 hover:text-red-600 shadow-sm border border-white/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              Purge Session Context
            </button>
          </div>
        </div>
      </aside>

      {/* ================================================================
          MAIN CONTENT
      ================================================================ */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden bg-white/20 backdrop-blur-lg relative">
        {/* ---- Top bar ------------------------------------------------ */}
        <header className="flex items-center gap-3 px-4 py-4 border-b border-white/40 bg-white/40 backdrop-blur-md shrink-0 shadow-sm z-10">
          {/* Sidebar toggle */}
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-xl text-slate-500 hover:text-blue-600 bg-white/50 hover:bg-white/80 transition-all shadow-sm border border-white/50"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <span className="text-[15px] font-bold tracking-wide text-slate-800">
            Intelligence Stream
          </span>

          {/* Error pill */}
          {error && (
            <span className="ml-auto text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">
              {error}
            </span>
          )}
        </header>

        {/* ---- Message list ------------------------------------------- */}
        <main ref={scrollRef as React.RefObject<HTMLDivElement>} className="flex-1 overflow-y-auto scrollbar-thin">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-w-3xl mx-auto py-4">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
            </div>
          )}
        </main>

        {/* ---- Input bar ---------------------------------------------- */}
        <footer className="shrink-0 border-t border-white/40 bg-white/30 backdrop-blur-xl px-4 pt-4 pb-6 shadow-[0_-8px_32px_0_rgba(31,38,135,0.05)] z-10">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 rounded-[2rem] border border-white/60 bg-white/70 backdrop-blur-xl px-5 py-3 shadow-[0_8px_32px_0_rgba(31,38,135,0.1)] focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-400/20 transition-all">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Query your active document corpus…"
                rows={1}
                disabled={isLoading && !messages.some((m) => m.streaming)}
                className="flex-1 resize-none bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-500 outline-none leading-relaxed max-h-44 overflow-y-auto scrollbar-hidden disabled:opacity-50"
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
            <p className="mt-2 text-center text-[11px] font-semibold tracking-wide text-slate-500">
              Press <kbd className="px-1.5 py-0.5 bg-white/50 rounded border border-white/60 shadow-sm">Enter</kbd> to query • <kbd className="px-1.5 py-0.5 bg-white/50 rounded border border-white/60 shadow-sm">Shift + Enter</kbd> for new line
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
