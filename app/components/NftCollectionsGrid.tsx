"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { NftImage } from "@/app/components/NftImage";
import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/nft/tradeportFee";
import { roundUpTo2Decimals } from "@/lib/client/amount";
import { proxiedImageUrl } from "@/lib/client/imageProxy";
import type { NftCollection } from "@/lib/nft/types";

type SortKey = "volume" | "floor";

const SORT_LABEL: Record<SortKey, string> = { floor: "Floor Price", volume: "Volume" };

function num(v: string | number | undefined): number {
  if (v == null) return -Infinity; // missing data sorts last, never pretend it's zero
  return Number(v);
}

// Real gap found live 2026-08-04 (user-reported): the Floor Price sort was
// pure floor-descending with zero consideration of volume — a collection
// with an inflated/fabricated floor and no real trading activity could rank
// #1, ahead of genuinely liquid blue chips. `hasRealVolume` groups
// collections with confirmed nonzero trading volume ahead of zero/unknown-
// volume ones, REGARDLESS of asc/desc direction (this is a quality signal,
// not a literal numeric ordering concern) — floor price only breaks ties
// within each group. Missing volume (vendor didn't report it) is treated
// the same as zero — no confirmed real trading either way, same "don't
// fabricate a signal we don't have" principle used throughout this file.
function hasRealVolume(c: NftCollection): boolean {
  return c.volume24hr != null && Number(c.volume24hr) > 0;
}

// Real bug found live 2026-07-22: this table showed Tradeport's raw
// floorPrice while the collection detail page (NftCollectionStats.tsx) and
// the listings grid (app/nft/[vendor]/[slug]/page.tsx's
// displayedListingPrice) both apply TRADEPORT_FEE_SAFETY_MARGIN — the same
// collection showed two different floor numbers depending on which page you
// were on. Applied here too, Tradeport-only, both for the displayed value
// AND the sort order (so cross-vendor floor sorting compares real,
// comparable costs, not raw-vs-fee-inclusive numbers).
function displayFloorPrice(c: NftCollection): number | undefined {
  if (c.floorPrice == null) return undefined;
  const raw = Number(c.floorPrice);
  return c.vendor === "tradeport" ? raw * (1 + TRADEPORT_FEE_SAFETY_MARGIN) : raw;
}

/**
 * Magic-Eden-style visual collection grid (2026-08-03 pass) — replaces the
 * ranked table (2026-07-21) with banner-crop + overlapping-avatar cards, the
 * same treatment ME's own home page uses. Every value rendered is still
 * driven only by fields `NftCollection` actually carries (see
 * lib/nft/types.ts's per-vendor availability notes) — a collection missing a
 * stat shows "—", never fabricated. `bannerImageUrl` is OpenSea/Ethereum-only
 * today; other vendors fall back to a blurred crop of their own avatar
 * image for the banner (see NftCollectionHero.tsx for the same trick used on
 * the detail page).
 */
export function NftCollectionsGrid({ collections }: { collections: NftCollection[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("floor");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const withIndex = collections.map((c, i) => ({ c, i }));
    withIndex.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === "volume") {
        av = num(a.c.volume24hr);
        bv = num(b.c.volume24hr);
      } else {
        const aHasVolume = hasRealVolume(a.c) ? 0 : 1;
        const bHasVolume = hasRealVolume(b.c) ? 0 : 1;
        if (aHasVolume !== bHasVolume) return aHasVolume - bHasVolume; // real-volume collections always ahead of zero/unknown-volume ones
        av = displayFloorPrice(a.c) ?? -Infinity;
        bv = displayFloorPrice(b.c) ?? -Infinity;
      }
      if (av === bv) return a.i - b.i; // stable: fall back to original vendor order
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return withIndex.map(({ c }) => c);
  }, [collections, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex w-fit gap-1 rounded-xl border border-hairline bg-surface p-1 shadow-sm">
        {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => {
          const active = sortKey === key;
          return (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
              }`}
            >
              {SORT_LABEL[key]}
              {active && <span aria-hidden="true">{sortDir === "desc" ? "↓" : "↑"}</span>}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((c, i) => {
          const floor = displayFloorPrice(c);
          return (
            <Link
              key={`${c.vendor}-${c.slug}`}
              href={`/nft/${c.vendor}/${encodeURIComponent(c.slug)}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg"
              style={{ animation: `fadeInUp 0.35s ease ${Math.min(i, 12) * 0.03}s both` }}
            >
              <div className="relative h-16 w-full overflow-hidden bg-accent-soft">
                {c.bannerImageUrl ? (
                  // Routed through /api/img (2026-08-04) — see lib/client/imageProxy.ts
                  <Image
                    src={proxiedImageUrl(c.bannerImageUrl)}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : c.imageUrl ? (
                  <Image
                    src={proxiedImageUrl(c.imageUrl)}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="scale-125 object-cover blur-lg"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-surface/80 via-transparent to-transparent" />
                <span className="absolute left-2 top-2 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                  #{i + 1}
                </span>
              </div>

              <div className="flex items-start gap-2.5 px-3 pt-0">
                <NftImage
                  src={c.imageUrl}
                  alt={c.name}
                  className="-mt-6 h-12 w-12 shrink-0 rounded-full ring-4 ring-surface"
                />
                <div className="flex min-w-0 flex-1 flex-col pt-1.5">
                  <span className="truncate text-sm font-semibold text-ink group-hover:text-accent">{c.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">{c.vendor}</span>
                </div>
              </div>

              <div className="mt-1 flex items-center gap-3 border-t border-hairline px-3 py-2 text-xs">
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">Floor</span>
                  {floor != null ? (
                    <span className="num font-semibold text-ink">
                      {roundUpTo2Decimals(floor)} <span className="text-ink-faint">{c.floorPriceCurrency}</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">Volume</span>
                  {c.volume24hr != null ? (
                    <span className="num font-semibold text-ink">
                      {Number(c.volume24hr).toFixed(2)} <span className="text-ink-faint">{c.volume24hrCurrency}</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function NftCollectionsGridSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="skeleton h-9 w-64 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            <div className="skeleton h-16 w-full" />
            <div className="flex items-start gap-2.5 px-3 pt-0">
              <div className="skeleton -mt-6 h-12 w-12 shrink-0 rounded-full ring-4 ring-surface" />
              <div className="flex flex-1 flex-col gap-1.5 pt-3">
                <div className="skeleton h-3.5 w-4/5 rounded" />
                <div className="skeleton h-2.5 w-1/3 rounded" />
              </div>
            </div>
            <div className="mt-3 flex gap-3 border-t border-hairline px-3 py-2">
              <div className="skeleton h-6 w-full rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
