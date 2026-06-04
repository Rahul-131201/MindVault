"use client";

import { useEffect } from "react";

export function ScrollToTop() {
  useEffect(() => {
    // Disable native browser scroll restoration to strictly force top
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    // Scroll to the very top immediately on load
    window.scrollTo(0, 0);

    // If there is a hash in the URL (e.g. #rag-ui) from a previous session, remove it
    // without refreshing the page, to prevent the browser from automatically scrolling down
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Fallback timeout to override Next.js hydration scroll overrides
    const timer = setTimeout(() => {
      window.scrollTo(0, 0);
    }, 100);

    return () => clearTimeout(timer);
  }, []);
  
  return null;
}
