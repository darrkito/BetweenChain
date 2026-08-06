"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { NftImage } from "@/app/components/NftImage";
import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/nft/tradeportFee";
import { magicEdenBuyerTotal } from "@/lib/nft/magicedenFee";
import { roundUpTo3Decimals } from "@/lib/client/amount";
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

// Real bug found live 2026-07-22 (Tradeport), extended 2026-08-05 (Magic
// Eden, real user report): this table showed each vendor's raw floorPrice
// while the collection detail page (NftCollectionStats.tsx) and the
// listings grid (CollectionPageClient.tsx's displayedListingPrice) both
// show fee-inclusive totals — the same collection showed different floor
// numbers depending on which page you were on. Applied here too, both for
// the displayed value AND the sort order (so cross-vendor floor sorting
// compares real, comparable costs, not raw-vs-fee-inclusive numbers).
// Magic Eden has no per-listing royalty data at this browse-all-collections
// level (no listings are loaded here, just aggregate stats) — falls back to
// magicEdenBuyerTotal's own default rate rather than fetching a live
// listing per card just for this, which would reintroduce the exact N+1
// this file's own earlier passes worked to eliminate.
function displayFloorPrice(c: NftCollection): number | undefined {
  if (c.floorPrice == null) return undefined;
  const raw = Number(c.floorPrice);
  if (c.vendor === "tradeport") return raw * (1 + TRADEPORT_FEE_SAFETY_MARGIN);
  if (c.vendor === "magiceden") return magicEdenBuyerTotal(raw, undefined);
  return raw;
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
type ViewMode = "grid" | "list";

export function NftCollectionsGrid({ collections }: { collections: NftCollection[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("floor");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Local-only, same as sortKey/sortDir above (not URL-synced) — resets on
  // navigation, matches the existing sort toggle's UX rather than adding a
  // new ?view= param for a purely presentational preference.
  const [view, setView] = useState<ViewMode>("grid");

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
      <div className="flex flex-wrap items-center justify-between gap-2">
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

        <div className="flex w-fit gap-1 rounded-xl border border-hairline bg-surface p-1 shadow-sm">
          {(["grid", "list"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              aria-label={mode === "grid" ? "Grid view" : "List view"}
              aria-pressed={view === mode}
              className={`inline-flex items-center justify-center rounded-lg p-1.5 transition-colors ${
                view === mode ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
              }`}
            >
              {mode === "grid" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="4.5" width="18" height="3" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="3" y="10.5" width="18" height="3" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="3" y="16.5" width="18" height="3" rx="1" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {view === "list" && (
        <div className="flex flex-col divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm">
          {sorted.map((c, i) => {
            const floor = displayFloorPrice(c);
            return (
              <Link
                key={`${c.vendor}-${c.slug}`}
                href={`/nft/${c.vendor}/${encodeURIComponent(c.slug)}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover"
              >
                <span className="w-6 shrink-0 text-right text-xs text-ink-faint">{i + 1}</span>
                <NftImage src={c.imageUrl} alt={c.name} className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">{c.vendor}</span>
                </div>
                <div className="flex w-24 shrink-0 flex-col items-end gap-0.5 text-xs">
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Floor</span>
                  {floor != null ? (
                    <span className="num font-semibold text-ink">
                      {roundUpTo3Decimals(floor)} <span className="text-ink-faint">{c.floorPriceCurrency}</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
                <div className="hidden w-28 shrink-0 flex-col items-end gap-0.5 text-xs sm:flex">
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Volume</span>
                  {c.volume24hr != null ? (
                    <span className="num font-semibold text-ink">
                      {Number(c.volume24hr).toFixed(2)} <span className="text-ink-faint">{c.volume24hrCurrency}</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {view === "grid" && (
        // 2026-08-06 (frontend audit — "UI/UX Pro Max... breaking out of
        // cookie-cutter card grid layouts to introduce intentional
        // asymmetry") — the current #1 by whichever sort is active (real
        // data, not a fixed pick) renders as a larger featured tile spanning
        // 2 columns, with bigger imagery/type; the rest stay in the compact
        // uniform grid. `sorted` already reorders on sort-key change, so
        // "featured" always tracks the genuinely top-ranked collection.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((c, i) => {
            const floor = displayFloorPrice(c);
            const featured = i === 0;
            return (
              <Link
                key={`${c.vendor}-${c.slug}`}
                href={`/nft/${c.vendor}/${encodeURIComponent(c.slug)}`}
                className={`group flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg ${featured ? "col-span-2" : ""}`}
                style={{ animation: `fadeInUp 0.35s ease ${Math.min(i, 12) * 0.03}s both` }}
              >
                <div className={`relative w-full overflow-hidden bg-accent-soft ${featured ? "h-28 sm:h-32" : "h-16"}`}>
                  {c.bannerImageUrl ? (
                    // Routed through /api/img (2026-08-04) — see lib/client/imageProxy.ts
                    <Image
                      src={proxiedImageUrl(c.bannerImageUrl)}
                      alt=""
                      aria-hidden="true"
                      fill
                      sizes={featured ? "(max-width: 640px) 100vw, 50vw" : "(max-width: 640px) 50vw, 25vw"}
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : c.imageUrl ? (
                    <Image
                      src={proxiedImageUrl(c.imageUrl)}
                      alt=""
                      aria-hidden="true"
                      fill
                      sizes={featured ? "(max-width: 640px) 100vw, 50vw" : "(max-width: 640px) 50vw, 25vw"}
                      className="scale-125 object-cover blur-lg"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-surface/80 via-transparent to-transparent" />
                  <span
                    className={`absolute left-2 top-2 rounded-full font-semibold text-white backdrop-blur-sm ${featured ? "bg-accent px-2 py-1 text-xs" : "bg-black/40 px-1.5 py-0.5 text-[11px]"}`}
                  >
                    #{i + 1}
                  </span>
                </div>

                <div className={`flex items-start gap-2.5 px-3 pt-0 ${featured ? "sm:gap-3.5" : ""}`}>
                  <NftImage
                    src={c.imageUrl}
                    alt={c.name}
                    className={`shrink-0 rounded-full ring-4 ring-surface ${featured ? "-mt-8 h-16 w-16 sm:-mt-9 sm:h-20 sm:w-20" : "-mt-6 h-12 w-12"}`}
                  />
                  <div className={`flex min-w-0 flex-1 flex-col pt-1.5 ${featured ? "sm:pt-2.5" : ""}`}>
                    <span
                      className={`font-display block truncate font-normal text-ink group-hover:text-accent ${featured ? "text-lg sm:text-xl" : "text-sm font-semibold"}`}
                    >
                      {c.name}
                    </span>
                    <span
                      className={`uppercase tracking-wide text-ink-faint ${featured ? "text-xs" : "text-[11px]"}`}
                    >
                      {c.vendor}
                    </span>
                  </div>
                </div>

                <div className={`mt-1 flex items-center gap-3 border-t border-hairline px-3 py-2 ${featured ? "text-sm" : "text-xs"}`}>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className={`uppercase tracking-wide text-ink-faint ${featured ? "text-xs" : "text-[11px]"}`}>Floor</span>
                    {floor != null ? (
                      <span className="num font-semibold text-ink">
                        {roundUpTo3Decimals(floor)} <span className="text-ink-faint">{c.floorPriceCurrency}</span>
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className={`uppercase tracking-wide text-ink-faint ${featured ? "text-xs" : "text-[11px]"}`}>Volume</span>
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
      )}
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
