"use client";

import { useEffect, useRef, useState } from "react";
import { TokenIcon } from "@/app/components/TokenIcon";
import type { TokenListItem } from "@/lib/chains/types";

export function TrendingBar({ chainId }: { chainId: number }) {
  const [items, setItems] = useState<TokenListItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/tokens/list?chainId=${chainId}`)
      .then((r) => r.json())
      .then((d: { tokens?: TokenListItem[] }) => {
        setItems((d.tokens ?? []).filter((t) => t.source === "trending").slice(0, 12));
      })
      .catch(() => setItems([]));
  }, [chainId]);

  if (items.length === 0) return null;

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
