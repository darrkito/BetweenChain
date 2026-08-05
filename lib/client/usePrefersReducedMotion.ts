"use client";

import { useEffect, useState } from "react";

// 2026-08-05 (hydration bug fix) — motion/react's own useReducedMotion() can
// resolve to a real boolean on the client's very first render (reading
// matchMedia immediately) while SSR has no window and defaults differently,
// so any component branching its OUTPUT STRUCTURE on that value (not just
// an animation prop) can render a different DOM shape server vs. client and
// fail hydration. This hook instead always returns `false` for the initial
// render on both server and client (guaranteeing the first paint matches),
// then updates to the real value inside an effect — a normal post-mount
// state update, not a hydration mismatch. Same "match on first render, sync
// truth after mount" pattern this app's own THEME_INIT_SCRIPT/ThemeToggle
// already uses for prefers-color-scheme.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    Promise.resolve().then(() => setReduced(mql.matches));
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);

  return reduced;
}
