"use client";

import { useCallback, useState } from "react";

// Same pattern as lib/client/useStarredChains.ts — 2026-08-06 visual/
// activity-drawer pass.
const STORAGE_KEY = "sbc_saved_addresses";
const MAX_ENTRIES = 10;

export interface SavedAddress {
  chainId: number;
  chainDisplayName: string;
  address: string;
  at: number; // Date.now()
}

export function readSavedAddressesFromStorage(): SavedAddress[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return []; // malformed/blocked localStorage — saved addresses is a pure convenience feature
  }
}

export function useSavedAddresses() {
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>(readSavedAddressesFromStorage);

  const addAddress = useCallback((entry: Omit<SavedAddress, "at">) => {
    setSavedAddresses((prev) => {
      const next = [
        { ...entry, at: Date.now() },
        ...prev.filter((a) => !(a.chainId === entry.chainId && a.address.toLowerCase() === entry.address.toLowerCase())),
      ].slice(0, MAX_ENTRIES);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { savedAddresses, addAddress };
}
