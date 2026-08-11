import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { TokenIcon } from "@/app/components/TokenIcon";
import { getAllBaskets } from "@/lib/content/baskets";

export const metadata: Metadata = {
  title: "Portfolio Baskets",
  description: "Split one token into a curated basket of destination tokens across chains, in one guided flow.",
  alternates: { canonical: "/basket" },
};

// Server component — reads BASKETS directly (a static in-repo array, see
// lib/content/baskets.ts's doc comment), same "no HTTP round-trip for data
// this process already has" principle as /games's own index page. No
// search/filter UI here (unlike /games) — proportionate to a small,
// hand-curated list, not a growing catalog yet.
export default function BasketIndexPage() {
  const baskets = getAllBaskets();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="flex flex-col gap-1 px-1">
        <h1 className="font-display text-2xl font-normal text-ink">🧺 Portfolio Baskets</h1>
        <p className="text-sm text-ink-muted">
          Split one token into a curated set of destination tokens across chains — one guided flow instead of several
          manual swaps.
        </p>
      </div>

      {/* 2026-08-12 (de-generic-ify pass, broader sweep) — same gap-px
          structural-grid treatment as the homepage's Features/More tools
          sections — see PLAN.md's "de-AI-ify" entry. */}
      <div className="grid grid-cols-1 gap-px border border-hairline bg-hairline sm:grid-cols-2">
        {baskets.map((basket) => (
          <Link
            key={basket.slug}
            href={`/basket/${basket.slug}`}
            className="flex flex-col gap-3 bg-surface p-5 transition-colors duration-100 hover:bg-surface-hover"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">
                {basket.icon}
              </span>
              <span className="font-display text-lg font-normal text-ink">{basket.name}</span>
            </div>
            <p className="text-sm text-ink-muted">{basket.description}</p>
            <div className="flex flex-wrap items-center gap-2">
              {basket.allocations.map((a) => (
                <span
                  key={`${a.chainId}:${a.address}`}
                  className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface-hover px-2.5 py-1 text-xs text-ink-muted"
                >
                  <TokenIcon logoURI={a.logoURI} symbol={a.symbol} size={16} />
                  {a.symbol} {a.percentage.toFixed(0)}%
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
