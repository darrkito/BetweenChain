"use client";

// 2026-08-04 (performance pass) — app/nft/page.tsx (the browse page) was
// converted to a Server Component the same session, server-fetching its
// data instead of client-fetch-on-mount. This page was evaluated for the
// same conversion (its collection-header fetch, specifically) and
// DEFERRED, not overlooked: this file was extensively reworked earlier the
// SAME session (sequencing the header fetch ahead of listings, splitting
// collectionLoading/listingsLoading and error/loadMoreError apart — see
// the effect below) to fix a real production bug. Splitting the header
// fetch out to a Server Component now, without live browser testing
// available, risks reintroducing a regression in code just stabilized.
// Real follow-up, not abandoned — the header fetch is already cleanly
// isolated (its own effect, own loading/error state) if/when this gets
// picked up with proper testing.
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { NftChainTabs } from "@/app/components/NftChainTabs";
import { NftCollectionHero, NftCollectionHeroSkeleton } from "@/app/components/NftCollectionHero";
import { NftCollectionStats, type ListedCountInfo, type TotalSupplyInfo } from "@/app/components/NftCollectionStats";
import { NftImage } from "@/app/components/NftImage";
import { NftTraitFilters, matchesTraitSelection, type TraitSelection } from "@/app/components/NftTraitFilters";
import { NftBuyModal } from "@/app/components/NftBuyModal";
import { NftBuyModalSui } from "@/app/components/NftBuyModalSui";
import { NftBuyModalMagicEden } from "@/app/components/NftBuyModalMagicEden";
import { isOnchainPunkListing } from "@/lib/nft/cryptopunksShared";
import { nftChainFamilyLabel, nftFamilyForVendor } from "@/lib/nft/labels";
import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/nft/tradeportFee";
import { roundUpTo2Decimals } from "@/lib/client/amount";
import type { NftCollection, NftListing } from "@/lib/nft/types";

type View = "listed" | "all";

/**
 * Same NFT can legitimately appear more than once in a single OpenSea
 * listings page — confirmed live 2026-07-20 (a real user-reported case:
 * Pudgy Penguin #8713 twice, same seller, same 4.752 ETH price, but two
 * genuinely different Seaport order hashes — the seller has two separate
 * active orders on the same token, not a fetch bug). Showing the same asset
 * twice is still confusing to a buyer who can only buy it once, so collapse
 * to the cheapest listing per token before rendering. Also covers the rarer
 * cross-page duplicate case (a token showing up again on the next cursor
 * page because the underlying live order book shifted between fetches).
 */
function dedupeListings(listings: NftListing[]): NftListing[] {
  const bestByToken = new Map<string, NftListing>();
  for (const l of listings) {
    const key = `${l.vendor}-${l.tokenId}`;
    const existing = bestByToken.get(key);
    if (!existing || (l.listed && (!existing.listed || Number(l.price) < Number(existing.price)))) {
      bestByToken.set(key, l);
    }
  }
  return Array.from(bestByToken.values());
}

/**
 * Tradeport's raw `listings.price` field is NOT the real total cost — it
 * charges its own fee/royalty on top that never appears anywhere in the
 * GraphQL data (confirmed live 2026-07-22 against a real completed
 * purchase, and separately corroborated against Tradeport's own website's
 * displayed "Buy" price). A real user report caught this: the grid was
 * showing the bare, un-fee'd price with no indication a real purchase
 * would cost more. Applies the same TRADEPORT_FEE_SAFETY_MARGIN the buy
 * flow itself uses, so a browsing user sees the same number they'd be
 * quoted a moment later — other vendors (OpenSea, Magic Eden) already
 * include their own fees in the displayed price, so this is Tradeport-only.
 */
function displayedListingPrice(l: NftListing): string {
  const raw = Number(l.price);
  if (l.vendor === "tradeport") return roundUpTo2Decimals(raw * (1 + TRADEPORT_FEE_SAFETY_MARGIN));
  return raw.toFixed(3);
}

// 2026-08-04 (real regression found and reverted, same session) — an
// earlier pass added a client-side retry loop here (up to 8 attempts) on
// top of the server's own internal retry (lib/nft/magiceden.ts's
// fetchMagicEden). Stacking two independent retry layers MULTIPLIES total
// upstream request volume instead of just waiting longer (up to 8 client
// attempts x up to 3 server attempts = up to 24 real requests to Magic Eden
// from one page load) — under a tight 60s/120-request rolling rate limit,
// that's enough to keep re-tripping it indefinitely rather than ever
// letting it clear. This was the actual cause of a user-reported "it used
// to load fine, now it never does" regression, not a genuine code bug.
// REMOVED — all patient-waiting now happens in exactly one place, server-
// side, as a single request (see app/api/nft/collection/route.ts's
// maxDuration=60 and fetchMagicEden's ~50s backoff budget). This page makes
// exactly one fetch per load, same as before any of today's changes; the
// only difference is that single fetch can now legitimately take up to
// ~55s before resolving instead of failing fast, and the loading skeleton
// below has copy explaining why.

export default function NftCollectionPage({ params }: { params: Promise<{ vendor: string; slug: string }> }) {
  const { vendor, slug: rawSlug } = use(params);
  // Real bug found live 2026-07-22 (Tradeport slugs containing `::`, e.g.
  // "0x...::pawtato_heroes::HERO" — 404'd with "Collection not found" on a
  // second visit to the same collection page). Confirmed live via the
  // server log: the first request for a given slug carried `%3A%3A` in its
  // query string (correct single encoding) while a later one for the exact
  // same page carried `%253A%253A` — `%3A` encoded a second time. The
  // precise Next.js mechanism producing that isn't fully pinned down (params
  // arriving pre-decoded on some navigations but not others is the leading
  // theory), but every downstream fetch here calls `encodeURIComponent(slug)`
  // exactly once, which is only correct if `slug` is already the raw,
  // decoded string — decoding defensively here guarantees that regardless of
  // which navigation path produced this render, and eliminates the double-
  // encoding by construction rather than depending on the exact cause. Safe
  // unconditionally: Tradeport/OpenSea/Magic Eden slugs never contain a
  // literal `%`, so decoding an already-decoded string is a no-op.
  const slug = decodeURIComponent(rawSlug);
  // Vendor maps 1:1 to a chain family (see lib/nft/labels.ts) — known
  // immediately from the route param, no need to wait for the collection
  // fetch below just to render the tabs/breadcrumb.
  const family = nftFamilyForVendor(vendor) ?? "solana";
  // "All items" (unlisted included) is only wired up for OpenSea today — see
  // lib/nft/tradeport.ts / lib/nft/magiceden.ts, neither has a confirmed
  // full-inventory endpoint in the public API.
  const supportsAllView = vendor === "opensea";

  const [collection, setCollection] = useState<NftCollection | null>(null);
  const [listings, setListings] = useState<NftListing[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  // Split 2026-08-04 (real bug, user report: entering a Solana/Magic Eden
  // collection showed the page-wide "marketplace is temporarily busy" error
  // instead of the collection header) — was a single `loading` covering both
  // the header AND the listings grid, fetched via Promise.all([collection,
  // firstPage]). See the collection-load effect below for the full fix.
  const [collectionLoading, setCollectionLoading] = useState(true);
  const [listingsLoading, setListingsLoading] = useState(true);
  // Manual retry trigger for a failed collection load (see the error banner
  // below) — included in the load effect's deps so clicking "Try again"
  // re-runs it. Deliberately manual, not automatic: see the block comment
  // above the component for why an automatic client-side retry loop was
  // removed (it multiplied upstream request volume against Magic Eden's
  // rate limit instead of helping).
  const [collectionRetryKey, setCollectionRetryKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Now scoped to the collection/header fetch only — a listings failure no
  // longer sets this (see loadMoreError below), so it never hides
  // already-successful header data behind a full-page error banner.
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` — real bug found live 2026-08-04: a loadMore()
  // failure (e.g. Magic Eden's listings pagination hitting its rate limit,
  // surfaced as a 503 "temporarily busy") was reusing `error`, which renders
  // a page-wide banner ABOVE the collection header. The header/stats/PFP
  // had already loaded fine from the initial fetch (a completely separate,
  // successful request) — showing a full "something's broken" banner next
  // to genuinely-working content was confusing and wrong. loadMore failures
  // are scoped to their own state, rendered near the grid/sentinel instead.
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [traitSelection, setTraitSelection] = useState<TraitSelection>({});
  const [view, setView] = useState<View>("listed");
  const [listedCountInfo, setListedCountInfo] = useState<ListedCountInfo | undefined>(undefined);
  const [totalSupplyInfo, setTotalSupplyInfo] = useState<TotalSupplyInfo | undefined>(undefined);
  // Real gap fixed 2026-08-03: the trait filter sidebar was `hidden md:flex`
  // with no mobile equivalent at all — below 768px, filters were completely
  // unreachable, not just hidden-behind-a-toggle. This state drives a
  // full-screen overlay (see the `md:hidden` toggle button + overlay below)
  // that renders the exact same `<NftTraitFilters>` the desktop sidebar
  // uses — same filter state, same options, just a different container.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Buy is only wired up for OpenSea listings (SOL-from-Solana -> EVM NFT,
  // see NftBuyModal.tsx's V1 scope note) — null when no modal should render.
  const [buyingListing, setBuyingListing] = useState<NftListing | null>(null);

  // Fired independently of, and after, the main collection/listings load —
  // computing an accurate listed count for OpenSea costs up to 20 sequential
  // upstream calls (see lib/nft/opensea.ts's countOpenSeaListedItems), so it
  // must never block the page itself from rendering.
  //
  // Magic Eden included here too as of 2026-08-04 (real bug, user report):
  // it used to get listedCount/floorPrice "for free" bundled into the main
  // /api/nft/collection response, but that bundling was itself the bug —
  // doubled Magic Eden's per-page request count (base collection + stats),
  // making the header specifically fail more often than the listings grid
  // under Magic Eden's tight, apparently key-agnostic rate limit (see
  // lib/nft/magiceden.ts's getMagicEdenCollection doc comment for the full
  // root-cause investigation). Now both vendors defer their secondary stats
  // the same way — the collection header itself only ever needs ONE
  // upstream call, matching listings' footprint.
  //
  // 2026-08-04 (SAME DAY, later) — gated on `collection` now, and skips this
  // fallback fetch entirely for Magic Eden when the merged single-call
  // response (see getMagicEdenCollection's doc comment) already populated
  // listedCount. The extra `collection.vendor === vendor && collection.slug
  // === slug` check guards against `collection` still holding the PREVIOUS
  // page's object during a navigation (the main load effect doesn't clear it
  // eagerly) — without it, a stale collection could be mistaken for this
  // one's data during the brief window between a vendor/slug change and the
  // new collection actually resolving.
  useEffect(() => {
    let ignore = false;
    if (vendor !== "opensea" && vendor !== "magiceden") {
      Promise.resolve().then(() => {
        if (!ignore) setListedCountInfo(undefined);
      });
      return () => {
        ignore = true;
      };
    }
    if (!collection || collection.vendor !== vendor || collection.slug !== slug) {
      return () => {
        ignore = true;
      };
    }
    if (vendor === "magiceden" && collection.listedCount != null) {
      Promise.resolve().then(() => {
        if (!ignore) {
          setListedCountInfo({
            count: collection.listedCount!,
            approximate: false,
            loading: false,
            floorPrice: collection.floorPrice,
            floorPriceCurrency: collection.floorPriceCurrency,
            volume: collection.volume24hr,
            volumeCurrency: collection.volume24hrCurrency,
            volumePeriodDays: collection.volumePeriodDays,
          });
        }
      });
      return () => {
        ignore = true;
      };
    }
    Promise.resolve()
      .then(() => {
        if (!ignore) setListedCountInfo({ count: 0, approximate: false, loading: true });
      })
      .then(() => fetch(`/api/nft/listed-count?vendor=${vendor}&slug=${encodeURIComponent(slug)}`))
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to count listings");
        return body as {
          count: number;
          approximate: boolean;
          floorPrice?: string;
          floorPriceCurrency?: string;
          volume?: string;
          volumeCurrency?: string;
          volumePeriodDays?: number;
        };
      })
      .then((body) => {
        if (!ignore) setListedCountInfo({ ...body, loading: false });
      })
      .catch(() => {
        if (!ignore) setListedCountInfo(undefined); // falls back to the "—" gap state, not a visible error for a secondary stat
      });
    return () => {
      ignore = true;
    };
  }, [vendor, slug, collection]);

  // Mirrors the listed-count effect above, other direction: Magic Eden gives
  // listedCount for free but no total supply — resolved lazily via Helius
  // DAS (see app/api/nft/total-supply/route.ts), independent of the main
  // page load. OpenSea already has totalSupply on its collection response,
  // no separate fetch needed there.
  useEffect(() => {
    let ignore = false;
    if (vendor !== "magiceden") {
      Promise.resolve().then(() => {
        if (!ignore) setTotalSupplyInfo(undefined);
      });
      return () => {
        ignore = true;
      };
    }
    Promise.resolve()
      .then(() => {
        if (!ignore) setTotalSupplyInfo({ value: null, loading: true });
      })
      .then(() => fetch(`/api/nft/total-supply?vendor=${vendor}&slug=${encodeURIComponent(slug)}`))
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to look up total supply");
        return body as { totalSupply: number | null };
      })
      .then((body) => {
        if (!ignore) setTotalSupplyInfo({ value: body.totalSupply, loading: false });
      })
      .catch(() => {
        if (!ignore) setTotalSupplyInfo(undefined); // falls back to the "—" gap state, not a visible error for a secondary stat
      });
    return () => {
      ignore = true;
    };
  }, [vendor, slug]);

  const fetchPage = useCallback(
    (pageCursor?: string) =>
      fetch(
        `/api/nft/listings?vendor=${vendor}&slug=${encodeURIComponent(slug)}&view=${view}${pageCursor ? `&cursor=${encodeURIComponent(pageCursor)}` : ""}`,
      ).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load listings");
        return body as { listings: NftListing[]; nextCursor?: string };
      }),
    [vendor, slug, view],
  );

  // Collection header, THEN first page of listings — resets whenever the
  // collection or view (Listed/All) changes.
  //
  // Fixed 2026-08-04 (real bug, user report): this used to fire both
  // requests via Promise.all([collectionFetch, fetchPage()]) — a single
  // shared `loading`/`error` covered both. That was wrong two ways: (1) it
  // doubled the immediate request burst against Magic Eden's already-thin
  // ~120 req/min keyless rate limit at the exact moment a collection page
  // opens, making a 429 more likely to happen at all; (2) Promise.all
  // rejects as soon as EITHER request fails, so a listings-only rate-limit
  // hit ("This marketplace is temporarily busy...") was wiping out
  // perfectly good, already-available header data (name/description/PFP/
  // stats) behind a full-page error banner instead of just showing that
  // error near the (empty) grid where it belongs.
  //
  // Now: fetch the collection header first. As soon as IT resolves, render
  // it immediately (setCollectionLoading(false)) and only THEN start the
  // listings request, with its own independent loading/error state
  // (listingsLoading/loadMoreError — the latter reused from the existing
  // scroll-pagination error state below, since a failed first page and a
  // failed next page render in the exact same place with the exact same
  // "Try again" retry affordance, and retrying just refetches with
  // cursor=undefined, which is correct for a first-page retry too).
  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => {
        if (ignore) return;
        setCollectionLoading(true);
        setListingsLoading(true);
        setError(null);
        setLoadMoreError(null);
        setListings([]);
        setCursor(undefined);
        setHasMore(true);
      })
      .then(() => fetch(`/api/nft/collection?vendor=${vendor}&slug=${encodeURIComponent(slug)}`))
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load collection");
        return body.collection as NftCollection;
      })
      .then((c) => {
        if (ignore) return;
        setCollection(c);
        setCollectionLoading(false);
        // Sequenced, not parallel — see the block comment above.
        return fetchPage()
          .then((page) => {
            if (ignore) return;
            setListings(dedupeListings(page.listings));
            setCursor(page.nextCursor);
            setHasMore(Boolean(page.nextCursor));
          })
          .catch((err) => {
            if (!ignore) setLoadMoreError((err as Error).message);
          })
          .finally(() => {
            if (!ignore) setListingsLoading(false);
          });
      })
      .catch((err) => {
        // Collection fetch itself failed — a genuine full-page problem.
        // Listings were never attempted in this branch, so clear its
        // loading flag too rather than leaving the grid skeleton spinning.
        if (!ignore) {
          setError((err as Error).message);
          setCollectionLoading(false);
          setListingsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- collection reload intentionally does NOT depend on fetchPage's identity beyond vendor/slug/view (already covered by fetchPage's own deps)
  }, [vendor, slug, view, collectionRetryKey]);

  // Search/trait filters reset independently of the collection reload above,
  // since switching Listed<->All shouldn't silently discard a filter the
  // user was mid-way through applying to the collection itself.
  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (ignore) return;
      setSearch("");
      setTraitSelection({});
    });
    return () => {
      ignore = true;
    };
  }, [vendor, slug]);

  const loadMore = useCallback(() => {
    if (loadingMore || listingsLoading || !hasMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    fetchPage(cursor)
      .then((page) => {
        setListings((prev) => dedupeListings([...prev, ...page.listings]));
        setCursor(page.nextCursor);
        setHasMore(Boolean(page.nextCursor));
      })
      .catch((err) => setLoadMoreError((err as Error).message))
      .finally(() => setLoadingMore(false));
  }, [fetchPage, cursor, hasMore, listingsLoading, loadingMore]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const filteredListings = useMemo(() => {
    const term = search.trim().toLowerCase();
    return listings.filter((l) => {
      if (term && !(l.name?.toLowerCase().includes(term) || l.tokenId.toLowerCase().includes(term))) return false;
      return matchesTraitSelection(l, traitSelection);
    });
  }, [listings, search, traitSelection]);

  const activeFilterCount = useMemo(
    () => Object.values(traitSelection).reduce((sum, values) => sum + values.size, 0),
    [traitSelection],
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <NftChainTabs active={family} />
      <Breadcrumb
        items={[
          { label: "NFTs", href: "/nft" },
          { label: nftChainFamilyLabel(family), href: `/nft?family=${family}` },
          { label: collection?.name ?? "…" },
        ]}
      />

      {error && (
        <div className="flex flex-col items-start gap-2 rounded-2xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button onClick={() => setCollectionRetryKey((k) => k + 1)} className="font-medium underline hover:no-underline">
            Try again
          </button>
        </div>
      )}

      {collection ? (
        <NftCollectionHero collection={collection} />
      ) : (
        collectionLoading && (
          <>
            <NftCollectionHeroSkeleton />
            {/* This single fetch can legitimately take up to ~55s now (see
                app/api/nft/collection/route.ts's maxDuration=60 and
                lib/nft/magiceden.ts's fetchMagicEden) when a vendor is
                rate-limiting us — this line exists so that doesn't read as
                a frozen page during a real, if uncommon, long wait. */}
            <p className="text-center text-xs text-ink-faint">This can take a moment if the marketplace is busy…</p>
          </>
        )
      )}

      {collection && <NftCollectionStats collection={collection} listedCountInfo={listedCountInfo} totalSupplyInfo={totalSupplyInfo} />}

      {supportsAllView && (
        <div className="flex w-fit gap-1 rounded-xl border border-hairline bg-surface p-1 shadow-sm">
          {(["listed", "all"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium capitalize transition-colors ${
                view === v ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
              }`}
            >
              {v === "listed" ? "Listed" : "All items"}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start gap-4">
        <aside className="hidden w-56 shrink-0 flex-col gap-3 md:flex">
          <NftTraitFilters listings={listings} selection={traitSelection} onChange={setTraitSelection} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m21 21-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or token ID"
                className="w-full rounded-xl border border-hairline bg-surface py-2.5 pl-10 pr-3 text-sm text-ink outline-none transition-colors focus:border-accent"
              />
            </div>
            {/* Only shown below `md` — the desktop sidebar (above) already
                covers this at `md:` and up. */}
            <button
              onClick={() => setMobileFiltersOpen(true)}
              className="relative shrink-0 rounded-xl border border-hairline bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-hover md:hidden"
            >
              Filters
              {activeFilterCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {!listingsLoading && listings.length > 0 && (
            <p className="px-1 text-xs text-ink-faint">
              <span className="num">{filteredListings.length}</span> of <span className="num">{listings.length}</span> loaded
              {hasMore && " · scroll for more"}
            </p>
          )}

          {!listingsLoading && !loadMoreError && listings.length === 0 && (
            <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-hairline py-16 text-center">
              <p className="text-sm font-medium text-ink">{view === "listed" ? "No active listings right now" : "No items found"}</p>
              {/*
                Real case, not a bug: some collections (CryptoPunks confirmed
                live 2026-08-03) trade through a legacy/custom marketplace
                contract instead of OpenSea's Seaport order book, so the
                listings API genuinely returns zero even though the
                collection has a real floor price and full inventory. Only
                surface the "All items" nudge when that view exists and would
                actually show something different, not as a generic dead end.
              */}
              {view === "listed" && supportsAllView ? (
                <>
                  <p className="max-w-xs text-sm text-ink-muted">
                    OpenSea&apos;s live order book has nothing listed here right now — some collections trade through
                    a marketplace flow outside it.
                  </p>
                  <button
                    onClick={() => setView("all")}
                    className="mt-2 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-ink transition-all hover:brightness-110"
                  >
                    Browse all items instead
                  </button>
                </>
              ) : (
                <p className="text-sm text-ink-muted">Check back soon, or browse another collection.</p>
              )}
            </div>
          )}

          {!listingsLoading && listings.length > 0 && filteredListings.length === 0 && (
            <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-hairline py-16 text-center">
              <p className="text-sm font-medium text-ink">No matches</p>
              <p className="text-sm text-ink-muted">Try a different search or fewer trait filters.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {listingsLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-hairline bg-surface">
                    <div className="skeleton aspect-square w-full" />
                    <div className="flex flex-col gap-1.5 p-2.5">
                      <div className="skeleton h-3.5 w-4/5 rounded" />
                      <div className="skeleton h-3 w-2/5 rounded" />
                    </div>
                  </div>
                ))
              : filteredListings.map((l, i) => (
                  // tokenId alone isn't unique here — OpenSea can return
                  // multiple simultaneous listings (separate orders) for the
                  // same NFT, confirmed live 2026-07-20 (React "duplicate
                  // key" warning on a real collection). Index as a
                  // tiebreaker is safe since this list is a static render
                  // after fetch, never reordered/filtered in place.
                  <div
                    key={`${l.vendor}-${l.tokenId}-${i}`}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg"
                    style={{ animation: `fadeInUp 0.3s ease ${Math.min(i, 20) * 0.02}s both` }}
                  >
                    <div className="relative aspect-square w-full overflow-hidden">
                      <NftImage
                        src={l.imageUrl ?? ""}
                        alt={l.name ?? l.tokenId}
                        className="h-full w-full transition-transform duration-300 group-hover:scale-110"
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                        #{i + 1}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 p-3">
                      <span className="truncate text-sm font-medium text-ink">{l.name ?? `#${l.tokenId.slice(0, 8)}`}</span>
                      {l.listed ? (
                        <>
                          <span className="num text-[15px] font-semibold text-ink">
                            {displayedListingPrice(l)} <span className="text-ink-muted">{l.priceCurrency}</span>
                          </span>
                          {(l.vendor === "opensea" && !isOnchainPunkListing(l)) ||
                          (l.vendor === "tradeport" && l.chainFamily === "move") ||
                          l.vendor === "magiceden" ? (
                            <button
                              onClick={() => setBuyingListing(l)}
                              className="mt-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-ink transition-all hover:brightness-110"
                            >
                              Buy
                            </button>
                          ) : (
                            <div className="mt-1 flex flex-col gap-0.5">
                              <button
                                disabled
                                title={
                                  isOnchainPunkListing(l)
                                    ? "This is a real on-chain listing, but buying it needs a direct contract call (CryptoPunksMarket.buyPunk) rather than OpenSea's usual flow — not wired up yet"
                                    : "Buy execution isn't wired up for this vendor yet"
                                }
                                className="w-fit cursor-not-allowed rounded-full bg-surface-hover px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                              >
                                Coming soon
                              </button>
                              {/* `title` above never fires on touch devices — this is the
                                  same explanation, just always visible, so mobile users
                                  aren't left guessing why the button is disabled. */}
                              <p className="px-1 text-[10px] leading-tight text-ink-faint">
                                {isOnchainPunkListing(l) ? "Needs a direct contract call — not wired up yet" : "Buy not wired up for this vendor yet"}
                              </p>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs font-medium text-ink-faint">Not listed</span>
                      )}
                    </div>
                  </div>
                ))}
          </div>

          <div ref={sentinelRef} className="h-1" />
          {loadingMore && <p className="pb-2 text-center text-xs text-ink-faint">Loading more…</p>}
          {loadMoreError && !loadingMore && (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <p className="text-xs text-danger">{loadMoreError}</p>
              <button onClick={loadMore} className="text-xs font-medium text-accent hover:underline">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      {buyingListing &&
        (buyingListing.vendor === "tradeport" ? (
          <NftBuyModalSui listing={buyingListing} onClose={() => setBuyingListing(null)} />
        ) : buyingListing.vendor === "magiceden" ? (
          <NftBuyModalMagicEden listing={buyingListing} onClose={() => setBuyingListing(null)} />
        ) : (
          <NftBuyModal listing={buyingListing} onClose={() => setBuyingListing(null)} />
        ))}

      {/* Mobile-only trait filter overlay — see mobileFiltersOpen's comment above. */}
      {mobileFiltersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-ink/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileFiltersOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl border border-hairline bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Filters</h2>
              <button onClick={() => setMobileFiltersOpen(false)} className="text-ink-faint hover:text-ink" aria-label="Close">
                ✕
              </button>
            </div>
            <NftTraitFilters listings={listings} selection={traitSelection} onChange={setTraitSelection} />
            <button
              onClick={() => setMobileFiltersOpen(false)}
              className="mt-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition-all hover:brightness-110"
            >
              Show {filteredListings.length} {filteredListings.length === 1 ? "item" : "items"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
