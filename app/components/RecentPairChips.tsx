"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { readRecentPairsFromStorage, type RecentPair } from "@/lib/client/useRecentPairs";
import { swapChainForChainId } from "@/lib/chains/swapChains";

// Surfaces the recent-pairs data useRecentPairs.ts already records on every
// completed swap (SwapPageClient.tsx's addPair call) but that had zero live
// UI wired to it — the only consumer, ActivityDrawer.tsx, is not rendered
// by any page (2026-08-18 retention audit). Read lazily in an effect, not
// a useState initializer, to avoid an SSR/client markup mismatch.
// Chain-level links only (native-token prefill via /swap?sell=&buy=), same
// granularity as QuickPairChips — the exact token swapped is shown as the
// label, but the ?sell=&buy= prefill mechanism only ever resolves to a
// chain's native token (see SwapPageClient.tsx's ?sell=&buy= effect).
export function RecentPairChips() {
  const [pairs, setPairs] = useState<RecentPair[]>([]);

  // Deferred via Promise.resolve().then(...) — same pattern
  // ActivityDrawer.tsx/ThemeToggle.tsx use for this exact
  // set-state-in-effect lint rule, avoiding a synchronous cascading render
  // directly inside the effect body.
  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) setPairs(readRecentPairsFromStorage());
    });
    return () => {
      ignore = true;
    };
  }, []);

  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Your recent swaps</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {pairs.slice(0, 4).map((p) => {
          const sellChain = swapChainForChainId(p.sellChainId);
          const buyChain = swapChainForChainId(p.buyChainId);
          if (!sellChain || !buyChain) return null;
          return (
            <Link
              key={`${p.sellChainId}-${p.sellSymbol}-${p.buyChainId}-${p.buySymbol}`}
              href={`/swap?sell=${sellChain.slug}&buy=${buyChain.slug}`}
              className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-ink"
            >
              <Image src={sellChain.iconUrl} alt="" width={14} height={14} className="rounded-full" />
              <span>{p.sellSymbol}</span>
              <span aria-hidden="true" className="text-ink-faint">
                →
              </span>
              <Image src={buyChain.iconUrl} alt="" width={14} height={14} className="rounded-full" />
              <span>{p.buySymbol}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
