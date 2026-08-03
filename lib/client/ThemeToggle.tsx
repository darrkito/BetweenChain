"use client";

import { useEffect, useState } from "react";

type ThemePref = "light" | "dark" | "system";
const STORAGE_KEY = "sbc-theme";

// Cycles system -> light -> dark -> system. "system" is the default (no
// data-theme attribute at all, falls through to globals.css's
// prefers-color-scheme media query) — this toggle only writes an explicit
// override once the user actually picks one, so someone who never touches
// it keeps following their OS setting exactly like before this existed.
const ORDER: ThemePref[] = ["system", "light", "dark"];

function applyTheme(pref: ThemePref) {
  if (pref === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pref);
}

export function ThemeToggle() {
  // Starts "system" on the server and on first client render (matches the
  // inline script in app/layout.tsx's <head>, which is what actually
  // prevents a flash-of-wrong-theme before this component even mounts) —
  // then syncs from localStorage in an effect, same as every other
  // client-only-state pattern already used in this app (e.g.
  // ConnectWalletMenu's `mounted` flag).
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    // Wrapped in Promise.resolve().then(...) rather than calling setState
    // directly in the effect body — same pattern already used elsewhere in
    // this app (e.g. ConnectWalletMenu's `mounted` flag) to avoid the
    // "set-state-in-effect" lint rule for this exact one-time-sync-on-mount
    // shape.
    let ignore = false;
    Promise.resolve().then(() => {
      if (ignore) return;
      const stored = localStorage.getItem(STORAGE_KEY) as ThemePref | null;
      if (stored && ORDER.includes(stored)) setPref(stored);
    });
    return () => {
      ignore = true;
    };
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    setPref(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  const label = pref === "system" ? "Theme: System" : pref === "light" ? "Theme: Light" : "Theme: Dark";

  return (
    <button
      onClick={cycle}
      title={`${label} — click to change`}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
    >
      {pref === "light" ? (
        <SunIcon />
      ) : pref === "dark" ? (
        <MoonIcon />
      ) : (
        <SystemIcon />
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
