"use client";

/**
 * components/ChatMessage.tsx
 *
 * Renders a single chat turn — user bubble or assistant bubble.
 *
 * Features:
 *   - Markdown rendering (GFM tables, code blocks with syntax highlight)
 *   - Animated typing indicator while streaming
 *   - Collapsible source citation cards
 *   - Fallback notice badge
 *   - Copy-to-clipboard on assistant messages
 *   - Dark mode compatible
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { BookOpen, Check, ChevronDown, ChevronUp, Copy, User, Bot } from "lucide-react";
import { clsx } from "clsx";
import type { UIMessage } from "@/hooks/useChat";
import type { SourceReference } from "@/lib/api";

// ---------------------------------------------------------------------------
// Typing indicator — three bouncing dots
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Thinking…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500 animate-pulse-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Source citation card
// ---------------------------------------------------------------------------

interface SourceCardProps {
  source: SourceReference;
  index: number;
}

function SourceCard({ source, index }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const scorePercent = Math.round(source.score * 100);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden text-xs">
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-brand-500" />
          <span className="font-medium truncate text-slate-700 dark:text-slate-200">
            [{index + 1}] {source.file_name}
          </span>
          {source.page != null && (
            <span className="text-slate-400 shrink-0">p.{source.page + 1}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Relevance score pill */}
          <span
            className={clsx(
              "rounded-full px-1.5 py-0.5 font-semibold",
              scorePercent >= 70
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                : scorePercent >= 40
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
            )}
          >
            {scorePercent}%
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          )}
        </div>
      </button>

      {/* Excerpt (collapsible) */}
      {expanded && (
        <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 leading-relaxed italic animate-fade-in">
          "{source.excerpt}"
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources panel
// ---------------------------------------------------------------------------

interface SourcesPanelProps {
  sources: SourceReference[];
}

function SourcesPanel({ sources }: SourcesPanelProps) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {open ? "Hide" : "Show"} {sources.length} source
        {sources.length !== 1 ? "s" : ""}
        {open ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {open && (
        <div className="space-y-1.5 animate-fade-in">
          {sources.map((src, i) => (
            <SourceCard key={`${src.document_id}-${src.chunk_index}`} source={src} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-slate-400" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main ChatMessage component
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  message: UIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming ?? false;
  const showEmpty = isStreaming && !message.content;

  return (
    <div
      className={clsx(
        "flex gap-3 px-4 py-4 animate-slide-up",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar */}
      <div
        className={clsx(
          "shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white shadow-sm",
          isUser
            ? "bg-brand-500"
            : "bg-slate-700 dark:bg-slate-600",
        )}
        aria-hidden
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={clsx(
          "group relative max-w-[80%] rounded-2xl px-4 py-3 shadow-sm",
          isUser
            ? "bg-brand-500 text-white rounded-tr-sm"
            : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-sm border border-slate-200 dark:border-slate-700",
        )}
      >
        {/* Copy button (assistant only) */}
        {!isUser && message.content && (
          <div className="absolute top-2 right-2">
            <CopyButton text={message.content} />
          </div>
        )}

        {/* Content */}
        <div className="pr-6">
          {showEmpty ? (
            <TypingIndicator />
          ) : isUser ? (
            /* User messages: plain text, preserve newlines */
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          ) : (
            /* Assistant messages: full Markdown with syntax highlighting */
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  /* Open links in new tab */
                  a: ({ href, children, ...props }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  ),
                  /* Style code blocks consistently */
                  pre: ({ children, ...props }) => (
                    <pre
                      className="rounded-lg overflow-x-auto bg-slate-900 dark:bg-slate-950 p-4 text-xs"
                      {...props}
                    >
                      {children}
                    </pre>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>

              {/* Streaming cursor */}
              {isStreaming && message.content && (
                <span className="inline-block w-0.5 h-4 bg-slate-500 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}
        </div>

        {/* Fallback notice */}
        {message.fallback && !isUser && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Answer from general knowledge — no matching documents found
          </div>
        )}

        {/* Sources */}
        {!isUser && (message.sources?.length ?? 0) > 0 && (
          <SourcesPanel sources={message.sources!} />
        )}

        {/* Timestamp */}
        <div
          className={clsx(
            "mt-1.5 text-[10px]",
            isUser ? "text-white/60 text-right" : "text-slate-400",
          )}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

export default ChatMessage;
