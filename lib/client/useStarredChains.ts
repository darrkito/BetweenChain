"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "sbc_starred_chains";

function readStarredFromStorage(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return []; // malformed/blocked localStorage — starring is a pure convenience feature
  }
}

export function useStarredChains() {
  const [starred, setStarred] = useState<number[]>(readStarredFromStorage);

  const toggle = useCallback((chainId: number) => {
    setStarred((prev) => {
      const next = prev.includes(chainId) ? prev.filter((id) => id !== chainId) : [...prev, chainId];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { starred, toggle };
}
