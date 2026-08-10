"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/client/AuthProvider";

// Header points pill (2026-08-10 UX-audit follow-up, Part 1 priority #4 —
// "points/referral system already exists server-side, just needs a small
// persistent UI counter"). Reuses the exact GET /api/points route + shape
// dashboard/page.tsx already fetches — no new backend. Gated on a real
// session existing so a signed-out visitor never fires the request (same
// "don't fetch what you already know will 401" discipline as other
// session-aware components in this app).
export function PointsPill() {
  const { sessionPubkey, evmVerifiedAddress } = useAuth();
  const signedIn = Boolean(sessionPubkey || evmVerifiedAddress);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!signedIn) {
      // Deferred via a microtask, not called synchronously in the effect
      // body — this repo enforces `react-hooks/set-state-in-effect`
      // strictly (see CollectionPageClient.tsx's mount-skip guards /
      // SwapPageClient.tsx's destination-autofill effects for the same
      // established workaround).
      Promise.resolve().then(() => setBalance(null));
      return;
    }
    let cancelled = false;
    fetch("/api/points")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { balance: number }) => {
        if (!cancelled) setBalance(d.balance);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn || balance === null) return null;

  return (
    <Link
      href="/dashboard"
      className="num hidden items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-accent/40 sm:flex"
      title="View points & referrals"
    >
      <span aria-hidden="true">✦</span>
      {balance.toLocaleString()}
    </Link>
  );
}
