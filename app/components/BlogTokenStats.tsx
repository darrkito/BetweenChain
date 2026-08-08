"use client";

import { useEffect, useState } from "react";
import { formatUsdCompact } from "@/lib/client/amount";

// Live token price/market-cap card, embeddable in a blog post's .mdx body
// via next-mdx-remote/rsc's `components` prop (app/blog/[slug]/page.tsx) —
// 2026-08-08. Client component fetching after mount, same pattern
// BlogSwapPreview.tsx already established for live data inside this MDX
// pipeline (a plain async Server Component passed through MDX's
// components map was avoided — no confirmed-working precedent for that in
// this app's MDX setup, and this pattern is already proven). Never bakes a
// price into the post's static text — a post committed once should never
// go stale the way a hardcoded "$0.0001" would within hours for a real
// memecoin.
export function BlogTokenStats({ mint, symbol, swapHref }: { mint: string; symbol: string; swapHref?: string }) {
  const [stats, setStats] = useState<{ usdPrice: number; marketCapUsd: number | null } | null | undefined>(undefined);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/tokens/stats?mint=${encodeURIComponent(mint)}`)
      .then((r) => (r.ok ? r.json() : { stats: null }))
      .then((body: { stats: { usdPrice: number; marketCapUsd: number | null } | null }) => {
        if (!ignore) setStats(body.stats);
      })
      .catch(() => {
        if (!ignore) setStats(null);
      });
    return () => {
      ignore = true;
    };
  }, [mint]);

  return (
    <div className="my-2 flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">${symbol} price</p>
          <p className="num text-lg font-semibold text-ink">
            {stats === undefined ? "…" : stats === null ? "—" : formatUsdCompact(stats.usdPrice)}
          </p>
        </div>
        {stats?.marketCapUsd != null && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Market cap</p>
            <p className="num text-lg font-semibold text-ink">{formatUsdCompact(stats.marketCapUsd)}</p>
          </div>
        )}
      </div>
      {swapHref && (
        <a href={swapHref} className="!text-accent-ink shrink-0 rounded-full bg-accent px-4 py-1.5 text-center text-sm font-semibold transition-all hover:brightness-110">
          Swap →
        </a>
      )}
    </div>
  );
}
