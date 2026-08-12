"use client";

import { useState } from "react";

// Top announcement strip (2026-08-12, item 3 of PLAN.md's Lovable-mockup
// plan) — full-bleed, above everything (rendered directly in app/layout.tsx,
// outside each page's own max-w container, unlike AppHeader). Every fact
// below is already true and already shown elsewhere on the site (hero tagline,
// lib/fees.ts, SWAP_CHAINS) — deliberately NOT the mockup's own "<30s swaps"
// claim, since nothing in this app measures swap speed (same fact-check bar
// the 2026-08-06 SEO pass already applies). Dismiss state persists via
// localStorage, same lazy-read/try-catch-write pattern as
// lib/client/useStarredChains.ts — a real, versioned key so a future change
// to the announcement content can reset dismissal if ever needed.
const STORAGE_KEY = "sbc_announcement_dismissed_v1";

const FACTS = ["0.25% flat fee per leg", "8 chains supported", "Zero manual bridging", "Destination address locked at quote time"];

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // blocked/unavailable localStorage — just show the bar
  }
}

export function AnnouncementBar() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore — dismissal just won't persist across reloads
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 border-b border-hairline bg-surface-hover px-3 py-1.5 text-center">
      <p className="truncate text-xs text-ink-muted">
        {FACTS.map((fact, i) => (
          <span key={fact}>
            {i > 0 && (
              <span className="mx-2 text-ink-faint" aria-hidden="true">
                •
              </span>
            )}
            {fact}
          </span>
        ))}
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 text-ink-faint transition-colors hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
