"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TierBadge } from "@/app/components/TierBadge";

// Compact points/referral summary for the swap page's side-card (2026-08-06
// visual pass) — same GET /api/points endpoint app/dashboard/page.tsx
// already uses, no new backend work. Renders nothing useful (a sign-in
// prompt) rather than a fake "0" when the request 401s — matches
// dashboard/page.tsx's own "sign in to see your points" fallback copy.
// `refreshKey` (2026-08-18, post-swap retention pass) — SwapPageClient
// bumps this when a swap completes so the balance actually visibly moves
// instead of staying frozen at whatever it was on mount; see the swap
// success block there for the "+N points earned" delta this enables.
export function PointsSummaryCard({ refreshKey }: { refreshKey?: string | number | null } = {}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    fetch("/api/points")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setBalance(d.balance))
      .catch(() => setSignedIn(false));
  }, [refreshKey]);

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <p className="text-sm text-ink-muted">Points & referrals</p>
      {signedIn ? (
        <>
          <p className="num text-3xl font-semibold text-ink">{balance ?? "—"}</p>
          {balance !== null && <TierBadge balance={balance} />}
        </>
      ) : (
        <p className="text-sm text-ink-faint">Sign in to see your points.</p>
      )}
      <Link href="/dashboard" className="text-sm font-semibold text-accent transition-opacity hover:opacity-80">
        View dashboard →
      </Link>
    </aside>
  );
}
