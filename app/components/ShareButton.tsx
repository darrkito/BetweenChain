"use client";

import { useState } from "react";

// 2026-08-06 (blog enrichment pass) — plain copy-link, no Web Share API
// branching: navigator.share() is mobile-Safari/Android-Chrome-only and
// silently absent everywhere else (desktop Chrome/Firefox), which would
// make this button's behavior inconsistent across visitors for no real
// benefit — copy-to-clipboard works identically everywhere.
export function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can throw in some sandboxed/insecure contexts —
      // nothing useful to recover into, just leave the button inert.
    }
  }

  return (
    <button
      onClick={handleClick}
      className="rounded-full border border-hairline px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
    >
      {copied ? "Copied!" : "Share"}
    </button>
  );
}
