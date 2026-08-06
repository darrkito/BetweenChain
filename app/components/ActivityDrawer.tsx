"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { readRecentPairsFromStorage, type RecentPair } from "@/lib/client/useRecentPairs";
import { readSavedAddressesFromStorage, type SavedAddress } from "@/lib/client/useSavedAddresses";
import { readSessionActivityFromStorage, type SessionActivityEntry } from "@/lib/client/useSessionActivity";
import { usePrefersReducedMotion } from "@/lib/client/usePrefersReducedMotion";

// Global slide-out drawer (2026-08-06 visual pass), rendered from
// AppHeader.tsx so it persists across page navigation. Reads the three
// localStorage-backed stores directly (not via their write-capable hooks —
// see useRecentPairs.ts etc.) and re-reads on every open, since a separate
// hook instance elsewhere on the page (e.g. SwapPageClient) writing to the
// same key wouldn't otherwise be visible to a hook instance that mounted
// earlier in this component. Cheap because it only happens on open, not on
// every render.
function timeAgo(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ActivityDrawer() {
  const [open, setOpen] = useState(false);
  const [recentPairs, setRecentPairs] = useState<RecentPair[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [sessionActivity, setSessionActivity] = useState<SessionActivityEntry[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    // Deferred via Promise.resolve().then(...) — same pattern
    // lib/client/ThemeToggle.tsx already uses for this exact
    // set-state-in-effect lint rule, avoiding a synchronous cascading
    // render directly inside the effect body.
    let ignore = false;
    Promise.resolve().then(() => {
      if (ignore) return;
      setRecentPairs(readRecentPairsFromStorage());
      setSavedAddresses(readSavedAddressesFromStorage());
      setSessionActivity(readSessionActivityFromStorage());
    });
    return () => {
      ignore = true;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Recent activity"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-ink-muted transition-all hover:border-accent/40 hover:text-accent active:scale-90"
      >
        <span aria-hidden="true">⏱</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-hairline bg-surface p-5 shadow-xl"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-normal text-ink">Activity</h2>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-ink"
                >
                  ✕
                </button>
              </div>

              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Recent pairs</p>
                {recentPairs.length === 0 ? (
                  <p className="text-sm text-ink-faint">No swaps yet.</p>
                ) : (
                  recentPairs.map((p) => (
                    <div
                      key={`${p.sellChainId}-${p.sellSymbol}-${p.buyChainId}-${p.buySymbol}`}
                      className="num flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm text-ink"
                    >
                      <span>
                        {p.sellSymbol} → {p.buySymbol}
                      </span>
                      <span className="text-xs text-ink-faint">{timeAgo(p.at)}</span>
                    </div>
                  ))
                )}
              </section>

              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Saved addresses</p>
                {savedAddresses.length === 0 ? (
                  <p className="text-sm text-ink-faint">No saved addresses yet.</p>
                ) : (
                  savedAddresses.map((a) => (
                    <div key={`${a.chainId}-${a.address}`} className="flex flex-col gap-0.5 rounded-xl border border-hairline px-3 py-2">
                      <span className="text-xs text-ink-faint">{a.chainDisplayName}</span>
                      <span className="num break-all text-xs text-ink">{a.address}</span>
                    </div>
                  ))
                )}
              </section>

              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Recent activity</p>
                {sessionActivity.length === 0 ? (
                  <p className="text-sm text-ink-faint">Nothing yet this session.</p>
                ) : (
                  sessionActivity.map((entry, i) => (
                    <div
                      key={`${entry.swapId}-${i}`}
                      className="num flex items-center justify-between rounded-xl border border-hairline px-3 py-2 text-sm"
                    >
                      <span className={entry.status === "error" ? "text-danger" : "text-ink"}>
                        {entry.sellSymbol} → {entry.buySymbol}
                      </span>
                      <span className="text-xs text-ink-faint">{timeAgo(entry.at)}</span>
                    </div>
                  ))
                )}
              </section>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
