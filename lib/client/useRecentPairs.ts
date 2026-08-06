"use client";

import { useCallback, useState } from "react";

// Same pattern as lib/client/useStarredChains.ts (lazy SSR-safe read,
// single try/catch-guarded writer) — 2026-08-06 visual/activity-drawer pass.
const STORAGE_KEY = "sbc_recent_pairs";
const MAX_ENTRIES = 8;

export interface RecentPair {
  sellChainId: number;
  sellSymbol: string;
  buyChainId: number;
  buySymbol: string;
  at: number; // Date.now()
}

export function readRecentPairsFromStorage(): RecentPair[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return []; // malformed/blocked localStorage — recent pairs is a pure convenience feature
  }
}

function samePair(a: RecentPair, b: Omit<RecentPair, "at">): boolean {
  return a.sellChainId === b.sellChainId && a.sellSymbol === b.sellSymbol && a.buyChainId === b.buyChainId && a.buySymbol === b.buySymbol;
}

export function useRecentPairs() {
  const [recentPairs, setRecentPairs] = useState<RecentPair[]>(readRecentPairsFromStorage);

  const addPair = useCallback((pair: Omit<RecentPair, "at">) => {
    setRecentPairs((prev) => {
      const next = [{ ...pair, at: Date.now() }, ...prev.filter((p) => !samePair(p, pair))].slice(0, MAX_ENTRIES);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { recentPairs, addPair };
}
