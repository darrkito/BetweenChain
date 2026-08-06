"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// 2026-08-06 (real user request) — the swap page's own "Connect wallet"
// button used to scroll-and-pulse the SEPARATE header ConnectWalletMenu
// button rather than actually opening anything itself, since that
// component's open/close state was local to itself (app/components/
// ConnectWalletMenu.tsx, rendered fresh per-page since AppHeader isn't in
// the root layout — see that file's own comment). Lifted into a context
// instantiated once here, at the true app root (app/providers.tsx), which
// survives client-side navigation regardless of how many times AppHeader
// itself remounts — so ANY button anywhere (the header's own, the swap
// page's, any future one) opens the exact same modal instance, not two
// different flows that happen to look alike.
interface ConnectWalletModalContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ConnectWalletModalContext = createContext<ConnectWalletModalContextValue | null>(null);

export function ConnectWalletModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <ConnectWalletModalContext.Provider value={{ open, setOpen }}>{children}</ConnectWalletModalContext.Provider>;
}

export function useConnectWalletModal(): ConnectWalletModalContextValue {
  const ctx = useContext(ConnectWalletModalContext);
  if (!ctx) throw new Error("useConnectWalletModal must be used within a ConnectWalletModalProvider");
  return ctx;
}
