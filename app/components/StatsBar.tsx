"use client";

import { useEffect, useState } from "react";
import { formatUsdCompact } from "@/lib/client/amount";

// Real stats counter (2026-08-10 UX-audit follow-up, Part 1 priority #3).
// Explicit "no" to the audit's fabricated "audit badges" suggestion — this
// app has never been audited by anyone — but real transaction/volume
// counts from GET /api/stats are a legitimate trust signal, same
// "real numbers only" rule TrustBar.tsx already follows for its partner
// list. Renders nothing while loading or on a genuine zero (a "0
// transactions" counter reads as a red flag, not a trust signal — same
// reasoning PLAN.md gave for deferring this until there's real volume to
// show), so this fails silent rather than ever showing a discouraging
// number.
export function StatsBar() {
  const [stats, setStats] = useState<{ totalTransactions: number; totalUsdVolume: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: { totalTransactions: number; totalUsdVolume: number }) => {
        if (!cancelled) setStats(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats || stats.totalTransactions === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm text-ink-muted">
      <span>
        <span className="num font-semibold text-ink">{stats.totalTransactions.toLocaleString()}</span> completed transactions
      </span>
      <span aria-hidden="true" className="text-ink-faint">
        ·
      </span>
      <span>
        <span className="num font-semibold text-ink">{formatUsdCompact(stats.totalUsdVolume)}</span> total volume
      </span>
    </div>
  );
}
