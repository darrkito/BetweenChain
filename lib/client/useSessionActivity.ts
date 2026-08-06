"use client";

import { useCallback, useState } from "react";

// Same pattern as lib/client/useStarredChains.ts. Deliberately NOT a real
// cross-device transaction history — no GET endpoint reads swap_transactions
// back for display anywhere in this app yet (see PLAN.md's "real
// transaction-history endpoint" backlog item, 2026-08-06) — this is just
// what completed in THIS browser, persisted locally so it survives a
// reload, not fetched from the server.
const STORAGE_KEY = "sbc_session_activity";
const MAX_ENTRIES = 20;

export interface SessionActivityEntry {
  swapId: string;
  sellSymbol: string;
  buySymbol: string;
  status: "done" | "error";
  at: number; // Date.now()
}

export function readSessionActivityFromStorage(): SessionActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return []; // malformed/blocked localStorage — session activity is a pure convenience feature
  }
}

export function useSessionActivity() {
  const [sessionActivity, setSessionActivity] = useState<SessionActivityEntry[]>(readSessionActivityFromStorage);

  const addActivity = useCallback((entry: Omit<SessionActivityEntry, "at">) => {
    setSessionActivity((prev) => {
      const next = [{ ...entry, at: Date.now() }, ...prev].slice(0, MAX_ENTRIES);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { sessionActivity, addActivity };
}
