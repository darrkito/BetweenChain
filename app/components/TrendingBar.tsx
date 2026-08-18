"use client";

import { useEffect, useRef, useState } from "react";
import { TokenIcon } from "@/app/components/TokenIcon";
import type { TokenListItem } from "@/lib/chains/types";

export function TrendingBar({ chainId }: { chainId: number }) {
  const [items, setItems] = useState<TokenListItem[]>([]);
  // Real CLS cause found via Lighthouse on /swap (2026-08-18): this
  // component used to render nothing at all (`return null`) until its
  // fetch resolved, then mount a whole new row — every element below it
  // (footer included) jumped down the instant that happened, scoring
  // 0.233 CLS. Distinguishing "still loading" from "fetched, genuinely
  // nothing trending" lets loading reserve the same height the real bar
  // ends up using, instead of collapsing to zero and popping back.
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Not re-armed to `true` here on chainId change — this component is
    // only ever mounted with a fixed chainId in practice (SwapPageClient
    // always passes SOLANA_CHAIN_ID_CLIENT), and the initial state above
    // already covers first mount; avoids a synchronous setState-in-effect
    // call for a case that doesn't happen.
    fetch(`/api/tokens/list?chainId=${chainId}`)
      .then((r) => r.json())
      .then((d: { tokens?: TokenListItem[] }) => {
        setItems((d.tokens ?? []).filter((t) => t.source === "trending").slice(0, 12));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [chainId]);

  if (!loading && items.length === 0) return null;

  if (loading) {
    // Exact same wrapper classes as the real bar below (not a hardcoded
    // pixel height guess) so the browser computes an identical height
    // from identical padding/font-size/line-height — real content swaps
    // in at the same height instead of the container resizing.
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface p-2 shadow-sm">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent opacity-0">
          Trending
        </span>
        <div className="flex flex-1 gap-2 overflow-hidden">
          <div className="h-7 w-20 shrink-0 animate-pulse rounded-full bg-surface-hover" />
          <div className="h-7 w-24 shrink-0 animate-pulse rounded-full bg-surface-hover" />
          <div className="h-7 w-20 shrink-0 animate-pulse rounded-full bg-surface-hover" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface p-2 shadow-sm">
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 17l6-6 4 4 8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 7h6v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Trending
      </span>
      <div ref={scrollRef} className="flex flex-1 gap-2 overflow-x-auto scroll-smooth">
        {items.map((t) => (
          <span
            key={`${t.chainId}-${t.address}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm font-medium text-ink"
          >
            <TokenIcon logoURI={t.logoURI} symbol={t.symbol} size={18} />
            {t.symbol}
          </span>
        ))}
      </div>
      <button
        onClick={() => scrollRef.current?.scrollBy({ left: 160, behavior: "smooth" })}
        className="shrink-0 text-ink-faint transition-colors hover:text-accent"
        aria-label="Scroll trending"
      >
        ›
      </button>
    </div>
  );
}
