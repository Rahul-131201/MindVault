import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: {
    default: "RAG System",
    template: "%s | RAG System",
  },
  description:
    "Production-ready Retrieval-Augmented Generation — upload documents, ask questions, get cited answers.",
  keywords: ["RAG", "AI", "LLM", "document Q&A", "knowledge base"],
  authors: [{ name: "RAG System" }],
  robots: { index: false, follow: false }, // private internal tool
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)",  color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
};

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={inter.variable}
      /**
       * `suppressHydrationWarning` is needed because we set the `dark` class
       * on <html> via an inline script (below) before React hydrates, which
       * causes a mismatch warning without this prop.
       */
      suppressHydrationWarning
    >
      <head>
        {/*
          Inline script runs synchronously before first paint.
          Reads the user's saved preference from localStorage and applies
          the `dark` class to <html> — prevents flash of wrong theme.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('rag_theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (saved === 'dark' || (!saved && prefersDark)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-surface dark:bg-surface-dark text-slate-900 dark:text-slate-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
