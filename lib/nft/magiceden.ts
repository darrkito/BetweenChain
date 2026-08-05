import "server-only";
import { cached } from "@/lib/cache";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import type { NftCollection, NftListing } from "@/lib/nft/types";

const MAGICEDEN_API = "https://api-mainnet.magiceden.dev/v2";
// Undocumented but public (no API key needed, confirmed live 2026-08-03) —
// this is what magiceden.io's own site calls to render its home page
// "Popular collections" ranking. See browseMagicEdenCollections below for
// why the documented v2 /collections endpoint can't be used for this.
const MAGICEDEN_STATS_API = "https://stats-mainnet.magiceden.io";
// 2026-08-04 (reliability pass) — raised 5min -> 15min. Name/description/
// image/floor/volume/listedCount all change slowly enough that showing them
// up to 15min stale is a non-issue (the buy flow always re-verifies a
// listing is still live immediately before execution — this cache only ever
// affects DISPLAY freshness, never what a purchase actually executes
// against). The real payoff is fewer upstream calls hitting Magic Eden's
// tight, apparently key-agnostic ~120 QPM/2 QPS limit (see
// getMagicEdenCollection's doc comment) — directly cuts how often the
// collection header 503s with "temporarily busy".
const COLLECTIONS_TTL_MS = 15 * 60_000;

// Only strictly required for the buy-instruction endpoints (see
// getMagicEdenBuyInstructions below) — collection browse/listings/stats
// reads are documented as public/keyless, confirmed live 2026-07-20. But ME's
// docs (docs.magiceden.io/reference/solana-api-keys, checked 2026-08-03)
// state the default keyless limit is a hard 120 QPM/2 QPS with no mention of
// whether authenticated requests get a separate/higher bucket — sent on
// every call below anyway (when present) since it can only help, never hurt,
// and it's the account-authenticated path going forward now that the key is
// confirmed active (see 2026-08-03g/h in STATE.md).
const MAGICEDEN_API_KEY = process.env.MAGICEDEN_API_KEY;

function magicEdenHeaders(): HeadersInit | undefined {
  return MAGICEDEN_API_KEY ? { Authorization: `Bearer ${MAGICEDEN_API_KEY}` } : undefined;
}

/**
 * ME's public rate limit (120 QPM/2 QPS, see above) resets on a rolling
 * 60-second window (confirmed live 2026-08-04 via the `retry-after: 60` /
 * `x-ratelimit-reset` response headers) — a request that lands right at the
 * edge of someone else's burst has a good chance of succeeding a moment
 * later. Real bug found live 2026-08-03: opening a collection page would
 * hard-fail on a transient 429 with no retry at all; fixed with a single
 * 800ms retry, later widened to 2 retries (2026-08-04 first pass).
 *
 * 2026-08-04 (SAME DAY, second pass — real regression found and reverted):
 * that first pass ALSO added a client-side retry loop on top of this one
 * (app/nft/[vendor]/[slug]/page.tsx) — stacking retries on two independent
 * layers multiplies total upstream request volume, which can keep
 * re-tripping a 60s/120-request rolling limit indefinitely instead of ever
 * letting it clear. REMOVED the client-side retry; widened this one to 6
 * attempts / ~50s of backoff instead, on the assumption a longer window
 * would ride out a transient burst.
 *
 * 2026-08-04/05 (SAME EVENING, third pass — reverted again, real data this
 * time): Magic Eden stayed down for HOURS across this session, confirmed
 * from both this machine AND Vercel production (different IP ranges
 * entirely) — a rolling 60s-window burst does not explain hours of
 * continuous 429s. Empirically, the long backoff bought ZERO benefit during
 * a real outage (every attempt in the 50s window still failed) while making
 * every single collection page open hang for ~46s before failing — a much
 * worse user experience than a fast, honest failure. Cut back down to
 * something short: 2 retries / ~2.4s total, matching the ORIGINAL
 * 2026-08-03 fix's intent (catch a brief edge-of-burst 429) without
 * gambling a near-minute of hang time on an outage no amount of in-request
 * waiting can fix. The manual "Try again" button (see
 * app/nft/[vendor]/[slug]/page.tsx) is the right tool for a user who wants
 * to keep trying through a longer outage, not a longer automatic wait.
 */
const DEFAULT_BACKOFF_SCHEDULE_MS = [800, 1600];

async function fetchMagicEden(url: string | URL, backoffScheduleMs: number[] = DEFAULT_BACKOFF_SCHEDULE_MS): Promise<Response> {
  let res = await fetchWithTimeout(url, { headers: magicEdenHeaders(), cache: "no-store" });
  for (const delayMs of backoffScheduleMs) {
    if (res.status !== 429) return res;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await fetchWithTimeout(url, { headers: magicEdenHeaders(), cache: "no-store" });
  }
  return res;
}

interface RawMagicEdenCollection {
  symbol: string;
  name: string;
  description?: string;
  image?: string;
  // 2026-08-04 (docs-driven change) — Magic Eden's own docs
  // (docs.magiceden.io/reference/get_collections) claim these fields are
  // present on the base collection object, which would let this single call
  // replace the separate getMagicEdenCollectionStats call entirely. This
  // directly CONTRADICTS an earlier live test the same day (see
  // getMagicEdenCollection's doc comment below) that found them absent on
  // this exact endpoint — ME's docs have already proven wrong once in this
  // same investigation (claimed `volumeAll`, live reality is `volume7d`,
  // see RawMagicEdenStats). Deliberately coded defensively: all optional,
  // toNftCollection below only uses them when actually present, and
  // getMagicEdenCollectionStats/the listed-count route stay as a fallback
  // for whichever ends up true live. Accept either volume field name since
  // we don't know which this endpoint actually returns without a live test
  // that wasn't possible to run in the same session this was written
  // (sustained rate-limit — see fetchMagicEden's doc comment).
  floorPrice?: number; // lamports
  listedCount?: number;
  volume7d?: number; // lamports
  volumeAll?: number; // lamports — docs' claimed name, likely wrong per volume7d precedent
  avgPrice24hr?: number; // lamports
}

interface RawMagicEdenStats {
  symbol: string;
  floorPrice?: number; // lamports
  listedCount?: number;
  // Both confirmed live 2026-08-04 (curl against a real symbol) — previously
  // unused. No 24h volume field exists on this endpoint, only 7d; there is
  // no extra call cost to capture these, they're already in the same
  // response we fetch for floorPrice/listedCount.
  volume7d?: number; // lamports
  avgPrice24hr?: number; // lamports
}

// Shape of stats-mainnet.magiceden.io's collection_stats/search response —
// distinct from RawMagicEdenCollection/RawMagicEdenStats above (those come
// from the documented api-mainnet.magiceden.dev/v2 host). fp/vol are already
// in native SOL units, not lamports, confirmed live 2026-08-03.
interface RawMagicEdenTopCollection {
  name: string;
  collectionSymbol: string;
  image?: string;
  fp?: number;
  fpListingCurrency?: string;
  vol?: number;
  currency?: string;
  totalSupply?: number;
  listedCount?: number;
  isVerified?: boolean;
}

function toNftCollectionFromStats(c: RawMagicEdenTopCollection): NftCollection {
  return {
    vendor: "magiceden",
    chainFamily: "solana",
    slug: c.collectionSymbol,
    name: c.name,
    description: "",
    imageUrl: c.image ?? "",
    floorPrice: c.fp != null ? c.fp.toString() : undefined,
    floorPriceCurrency: c.fpListingCurrency,
    listedCount: c.listedCount,
    totalSupply: c.totalSupply,
    volume24hr: c.vol != null ? c.vol.toString() : undefined,
    volume24hrCurrency: c.currency,
  };
}

interface RawMagicEdenListing {
  pdaAddress: string;
  auctionHouse: string;
  tokenAddress: string;
  tokenMint: string;
  seller: string;
  price: number; // SOL, not lamports
  rarity?: { moonrank?: { rank: number } };
  extra?: { img?: string };
  // The listing response already embeds the full token record — name, image,
  // and attributes — confirmed live 2026-07-20 against a real okay_bears
  // listing. No separate per-token metadata call needed, unlike OpenSea's
  // listings endpoint (see lib/nft/opensea.ts).
  // collectionName added 2026-08-05 — confirmed live present on this same
  // response, used by fetchPinnedCollection below (a pinned collection has
  // no other working source for its display name, see that function's
  // comment).
  token?: { name?: string; image?: string; collectionName?: string; attributes?: Array<{ trait_type: string; value: string }> };
}

// floorPrice/listedCount/volume are populated here ONLY when the base
// endpoint actually returns them (see RawMagicEdenCollection's comment on
// why this is uncertain) — if absent, these stay undefined and the caller
// (app/nft/[vendor]/[slug]/page.tsx's listedCountInfo effect) falls back to
// the separate getMagicEdenCollectionStats call, same as before this change.
function toNftCollection(c: RawMagicEdenCollection): NftCollection {
  // Only c.volume7d is trusted for display — its unit/period is already
  // live-confirmed (see RawMagicEdenStats). c.volumeAll (the docs' claimed
  // field, unverified) is deliberately NOT surfaced here: an all-time figure
  // mislabeled "7d Volume" would be a worse bug than just showing "—" until
  // this can be live-verified.
  return {
    vendor: "magiceden",
    chainFamily: "solana",
    slug: c.symbol,
    name: c.name,
    description: c.description ?? "",
    imageUrl: c.image ?? "",
    floorPrice: c.floorPrice != null ? (c.floorPrice / 1e9).toString() : undefined,
    floorPriceCurrency: c.floorPrice != null ? "SOL" : undefined,
    listedCount: c.listedCount,
    volume24hr: c.volume7d != null ? (c.volume7d / 1e9).toString() : undefined,
    volume24hrCurrency: c.volume7d != null ? "SOL" : undefined,
    volumePeriodDays: c.volume7d != null ? 7 : undefined,
  };
}

async function fetchMagicEdenTopCollectionsBySort(sort: "volume" | "floorPrice", limit: number): Promise<RawMagicEdenTopCollection[]> {
  const url = new URL(`${MAGICEDEN_STATS_API}/collection_stats/search/solana`);
  url.searchParams.set("window", "1d");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", sort);
  url.searchParams.set("direction", "desc");
  const res = await fetchMagicEden(url);
  if (!res.ok) throw new Error(`Magic Eden top collections failed (${res.status})`);
  return res.json();
}

/**
 * Ranked top collections, floor price + volume both included — matches how
 * browseOpenSeaCollections (order_by=seven_day_volume) and
 * browseTradeportCollections (order_by:{volume:desc}) already rank the
 * EVM/Move browse pages, so all three chain families show a genuinely
 * ranked "top collections" list with floor+volume, not an arbitrary one.
 *
 * The documented `${MAGICEDEN_API}/collections` endpoint (previously used
 * here) can't do this: confirmed live it has no sort/rank param at all —
 * plain pagination in whatever internal order ME stores them, dominated by
 * spam/test entries ("The Bullpen TEST" ranked ahead of real collections)
 * — and it returns no floor/volume data per collection either, so every
 * card would show "—" for both. Switched 2026-08-03 to the same internal
 * stats API magiceden.io's own home page renders its "Popular collections"
 * table from (undocumented, but public — no API key required).
 *
 * Real gap found live 2026-08-04 (user-reported): fetching by `sort=volume`
 * ONLY meant a genuine blue-chip like "Claynosaurz: The Call of Saga" (fp
 * 18.25 SOL, confirmed live) never appeared at all — its 24h volume is too
 * low to make a volume-only top-20, and the frontend's Floor/Volume sort
 * toggle can only re-sort collections that were already fetched, it can't
 * pull in ones that were never fetched to begin with. Fixed by fetching
 * BOTH `sort=volume` and `sort=floorPrice` (confirmed live: this second
 * sort value is accepted by the same endpoint) and merging+deduping by
 * `collectionSymbol` — a collection that's top-ranked by EITHER metric now
 * always makes the list, regardless of which sort the user picks in the UI.
 *
 * `isVerified` filter added 2026-08-04 (explicit user request, for
 * consistency with Tradeport's identical `verified: true` filter — see
 * browseTradeportCollections) — checked live: the top 20 by both volume
 * and floor were already essentially all `isVerified: true` with only a
 * couple of small-but-real exceptions (e.g. "Drifella III"), so this is a
 * modest trust/quality tightening here rather than a spam fix the way it
 * was for Tradeport (where unverified floor-sorted results were
 * outright fabricated prices). A small number of legitimate but unbadged
 * collections will no longer appear — accepted trade-off per the request.
 */
// 2026-08-05 (real user report — "Claynosaurz: The Call of Saga", symbol
// "saga") — stats-mainnet's collection_stats/search endpoint draws from a
// fixed, internally-curated pool of real, actively-tracked collections
// (confirmed live: raising the fetch limit past ~394 returns nothing more —
// a hard ceiling on Magic Eden's own data, not a cutoff we control). A real
// collection with a real floor price can be excluded from that pool if it
// doesn't clear whatever activity/liquidity threshold Magic Eden applies
// internally — "saga" has a genuine 16.5 SOL floor and real listings
// (confirmed live via its own /stats and /listings endpoints) but zero
// presence in the tracked pool. No public API exists to discover
// collections like this (confirmed via extensive doc research) — the only
// way to include one is knowing its exact symbol ahead of time and pinning
// it here by hand. Small and manually maintained on purpose: this is a
// workaround for a real gap in Magic Eden's own data, not a general
// mechanism, and should stay short.
const MAGICEDEN_PINNED_SYMBOLS: readonly string[] = ["saga"];

// Deliberately does NOT use getMagicEdenCollection (the base
// /v2/collections/{symbol} endpoint) — confirmed live 2026-08-05 that this
// specific sub-path has its own, independently-exhausted rate-limit bucket
// separate from /stats and /listings (both confirmed working at the same
// moment this one 429'd). A pinned collection is by definition NOT in the
// stats-mainnet pool, so getMagicEdenCollection would always fall through
// to exactly the struggling endpoint — the one path guaranteed to defeat
// the whole point of pinning. Name/image instead come from a single real
// listing (`/listings?limit=1`, confirmed working) — Magic Eden's listing
// payload already embeds `token.collectionName`/`token.image`, no separate
// call needed.
async function fetchPinnedCollection(symbol: string): Promise<NftCollection | undefined> {
  return cached(`magiceden:pinned:${symbol}`, COLLECTIONS_TTL_MS, async () => {
    const [stats, listingRes] = await Promise.all([
      getMagicEdenCollectionStats(symbol),
      fetchMagicEden(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}/listings?offset=0&limit=1`),
    ]);
    if (!listingRes.ok) return undefined;
    const listings = (await listingRes.json()) as RawMagicEdenListing[];
    const token = listings[0]?.token;
    if (!token) return undefined;
    return {
      vendor: "magiceden" as const,
      chainFamily: "solana" as const,
      slug: symbol,
      name: token.collectionName ?? symbol,
      description: "",
      imageUrl: token.image ?? "",
      floorPrice: stats.floorPrice,
      floorPriceCurrency: stats.floorPriceCurrency,
      listedCount: stats.listedCount,
      volume24hr: stats.volume7d,
      volume24hrCurrency: stats.volume7dCurrency,
      volumePeriodDays: stats.volume7d != null ? 7 : undefined,
    };
  }).catch(() => undefined);
}

export async function browseMagicEdenCollections(limit = 20): Promise<NftCollection[]> {
  return cached(`magiceden:top-collections:${limit}`, COLLECTIONS_TTL_MS, async () => {
    // 2026-08-05 (real bug, found live): stats-mainnet.magiceden.io (byVolume/
    // byFloor's host) and api-mainnet.magiceden.dev (pinned's host) are
    // independent — confirmed live one can be down while the other works.
    // A plain Promise.all here meant a stats-mainnet failure threw before
    // pinned's own already-successful result was ever used, discarding
    // fully-working data for an unrelated reason. Promise.allSettled +
    // per-source fallback to [] keeps each source's failure contained to
    // itself. Pre-existing gap, not introduced by pinned collections — this
    // also fixes browse throwing entirely on any single stats-mainnet
    // hiccup, which was already true before today.
    const [byVolumeResult, byFloorResult, ...pinned] = await Promise.allSettled([
      fetchMagicEdenTopCollectionsBySort("volume", limit),
      fetchMagicEdenTopCollectionsBySort("floorPrice", limit),
      ...MAGICEDEN_PINNED_SYMBOLS.map(fetchPinnedCollection),
    ]);
    const byVolume = byVolumeResult.status === "fulfilled" ? byVolumeResult.value : [];
    const byFloor = byFloorResult.status === "fulfilled" ? byFloorResult.value : [];
    const bySymbol = new Map<string, RawMagicEdenTopCollection>();
    for (const row of [...byVolume, ...byFloor]) {
      if (row.isVerified && !bySymbol.has(row.collectionSymbol)) bySymbol.set(row.collectionSymbol, row);
    }
    const result = Array.from(bySymbol.values()).map(toNftCollectionFromStats);
    // Client-side sort (NftCollectionsGrid, by floor/volume) repositions
    // these correctly regardless of insertion order — appending is fine.
    // fetchPinnedCollection already catches its own errors internally
    // (never rejects), so every entry here is "fulfilled" — .value can
    // still be undefined on a real failure, which is what's actually checked.
    for (const settled of pinned) {
      const p = settled.status === "fulfilled" ? settled.value : undefined;
      if (p && !result.some((r) => r.slug === p.slug)) result.push(p);
    }
    return result;
  });
}

const SEARCH_POOL_SIZE = 250;
const SEARCH_TTL_MS = 60_000;

/**
 * Best-effort search — Magic Eden has NO documented name-search endpoint
 * for Solana collections (checked 2026-08-05: their only public "Search
 * Collections" API, docs.magiceden.io/reference/searchcollections, is
 * scoped to `v4/evm-public` — their EVM product line, which they already
 * shut down in 2026-03, see PLAN.md — not usable for the Solana collections
 * this app actually lists). Unlike searchOpenSeaCollections/
 * searchTradeportCollections, this is NOT a true universal search: it
 * fetches a larger pool (250 by volume + 250 by floor, same merge/dedupe
 * pattern as browseMagicEdenCollections but ~12x the pool size) and filters
 * by substring match server-side. A collection ranked outside the top ~500
 * by both metrics genuinely won't be found — an accepted, documented gap,
 * not a silent limitation. `isVerified` filter intentionally dropped here
 * (unlike browse) — a user searching a specific name wants that exact
 * collection even if unbadged, same reasoning as the OpenSea/Tradeport
 * search functions not applying browse's trust filter either.
 *
 * MAGICEDEN_PINNED_SYMBOLS are also checked here (real name match against
 * the query) — the manual workaround above for collections Magic Eden's own
 * pool excludes, see that constant's comment for the full "saga" story.
 */
export async function searchMagicEdenCollections(query: string, limit = 20): Promise<NftCollection[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  return cached(`magiceden:search:${trimmed}:${limit}`, SEARCH_TTL_MS, async () => {
    // See browseMagicEdenCollections's identical comment — stats-mainnet and
    // pinned's api-mainnet calls are independent sources, allSettled keeps
    // one source's failure from discarding the other's real result.
    const [byVolumeResult, byFloorResult, ...pinned] = await Promise.allSettled([
      fetchMagicEdenTopCollectionsBySort("volume", SEARCH_POOL_SIZE),
      fetchMagicEdenTopCollectionsBySort("floorPrice", SEARCH_POOL_SIZE),
      ...MAGICEDEN_PINNED_SYMBOLS.map(fetchPinnedCollection),
    ]);
    const byVolume = byVolumeResult.status === "fulfilled" ? byVolumeResult.value : [];
    const byFloor = byFloorResult.status === "fulfilled" ? byFloorResult.value : [];
    const bySymbol = new Map<string, RawMagicEdenTopCollection>();
    for (const row of [...byVolume, ...byFloor]) {
      if (!bySymbol.has(row.collectionSymbol) && row.name.toLowerCase().includes(trimmed)) {
        bySymbol.set(row.collectionSymbol, row);
      }
    }
    const result = Array.from(bySymbol.values()).map(toNftCollectionFromStats);
    for (const settled of pinned) {
      const p = settled.status === "fulfilled" ? settled.value : undefined;
      if (p && p.name.toLowerCase().includes(trimmed) && !result.some((r) => r.slug === p.slug)) result.push(p);
    }
    return result.slice(0, limit);
  });
}

/**
 * Split from stats 2026-08-04 (real bug, user report: Solana collection
 * pages showed the header failing while the listings grid loaded fine, on
 * OpenSea/Sui this worked). Root cause: this used to fire the base
 * collection call AND the /stats call together via Promise.all — TWO
 * upstream requests per page open, vs getMagicEdenListings' ONE. Confirmed
 * live: Magic Eden's collections-read rate limit (~120 QPM/2 QPS,
 * undocumented whether MAGICEDEN_API_KEY even raises it — tested live
 * 2026-08-04, identical 429 with and without the Authorization header, so
 * assume it does NOT for this endpoint) is tight enough that doubling the
 * per-page-load request count measurably doubles how often the header
 * specifically gets rate-limited compared to listings, for the exact same
 * user action. This only fetches the base collection (name/description/
 * image) — ONE call, same footprint as listings. floorPrice/listedCount
 * used to always require a separate, deferred getMagicEdenCollectionStats
 * call for that same live-tested reason.
 *
 * 2026-08-04 (SAME DAY, docs-driven change — unresolved conflict, see
 * RawMagicEdenCollection's comment): Magic Eden's docs claim this base
 * endpoint DOES include floorPrice/listedCount/volume, contradicting the
 * live test above from earlier the same day. Rather than trust either
 * source blindly, toNftCollection now opportunistically reads these fields
 * IF present on this response. The listed-count route/listedCountInfo
 * effect (app/nft/[vendor]/[slug]/page.tsx) still exists as a fallback and
 * only fires when this call's collection object comes back without
 * listedCount — so this is safe either way the doc-vs-live conflict
 * resolves.
 *
 * 2026-08-05 (real user request — genuinely different host, not just a
 * different endpoint): `api-mainnet.magiceden.dev` (this function's host)
 * has been sitewide rate-limited for hours this session, confirmed live.
 * `stats-mainnet.magiceden.io` (a SEPARATE host, already used by
 * browseMagicEdenCollections/searchMagicEdenCollections) is a genuinely
 * independent rate-limit bucket — confirmed live 2026-08-05: api-mainnet
 * 429, stats-mainnet 200, at the same moment. Now tries stats-mainnet
 * FIRST via resolveFromStatsPool below (same working host the browse/search
 * paths already depend on), only falling back to this api-mainnet call when
 * the symbol isn't found there (a collection outside the top ~300 by
 * volume/floor — genuinely needs the direct lookup, no way around it).
 * Bonus: a stats-pool hit already carries floorPrice/listedCount/volume (a
 * real 24h figure this time, via stats-mainnet's own `window=1d` — more
 * accurate than api-mainnet's 7d field), so it also skips the separate
 * listed-count fallback call same as the docs-driven merge above. The one
 * real gap: stats-mainnet has no `description` field at all — a stats-pool
 * hit always has an empty description, honestly, not fabricated.
 */
async function resolveFromStatsPool(symbol: string): Promise<NftCollection | undefined> {
  return cached(`magiceden:collection-viastats:${symbol}`, COLLECTIONS_TTL_MS, async () => {
    const [byVolume, byFloor] = await Promise.all([
      fetchMagicEdenTopCollectionsBySort("volume", SEARCH_POOL_SIZE),
      fetchMagicEdenTopCollectionsBySort("floorPrice", SEARCH_POOL_SIZE),
    ]);
    const match = [...byVolume, ...byFloor].find((c) => c.collectionSymbol === symbol);
    return match ? toNftCollectionFromStats(match) : undefined;
  });
}

export async function getMagicEdenCollection(symbol: string): Promise<NftCollection | undefined> {
  const viaStats = await resolveFromStatsPool(symbol).catch(() => undefined);
  if (viaStats) return viaStats;

  // 2026-08-05 (real bug, found live: /nft/magiceden/saga's header always
  // 503'd) — a pinned collection (see MAGICEDEN_PINNED_SYMBOLS) is by
  // definition NOT in the stats pool above, so without this check every
  // single request for it would fall through to exactly the struggling
  // api-mainnet base endpoint below (the same one browseMagicEdenCollections/
  // searchMagicEdenCollections were already fixed to avoid — see
  // fetchPinnedCollection's doc comment). The collection DETAIL PAGE header
  // calls this function directly and had no equivalent fix yet.
  if (MAGICEDEN_PINNED_SYMBOLS.includes(symbol)) {
    const viaPinned = await fetchPinnedCollection(symbol);
    if (viaPinned) return viaPinned;
  }

  return cached(`magiceden:collection:${symbol}`, COLLECTIONS_TTL_MS, async () => {
    const res = await fetchMagicEden(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}`);
    // Only a real 404 means "no such collection" — any other non-ok status
    // (e.g. 429 from ME's aggressive ~120 req/min keyless rate limit,
    // confirmed live 2026-07-20) must surface as an error, not be silently
    // swallowed into "not found" (a real bug this exact confusion caused
    // during live verification — see STATE.md).
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Magic Eden collection lookup failed (${res.status})`);
    const collection = (await res.json()) as RawMagicEdenCollection;
    return toNftCollection(collection);
  });
}

export interface MagicEdenCollectionStats {
  listedCount?: number;
  floorPrice?: string;
  floorPriceCurrency?: string;
  volume7d?: string;
  volume7dCurrency?: string;
}

/** See getMagicEdenCollection's doc comment above for why this is separate. */
export async function getMagicEdenCollectionStats(symbol: string): Promise<MagicEdenCollectionStats> {
  return cached(`magiceden:collection-stats:${symbol}`, COLLECTIONS_TTL_MS, async () => {
    const res = await fetchMagicEden(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}/stats`);
    if (!res.ok) return {};
    const stats = (await res.json()) as RawMagicEdenStats;
    return {
      listedCount: stats.listedCount,
      floorPrice: stats.floorPrice != null ? (stats.floorPrice / 1e9).toString() : undefined,
      floorPriceCurrency: "SOL",
      volume7d: stats.volume7d != null ? (stats.volume7d / 1e9).toString() : undefined,
      volume7dCurrency: "SOL",
    };
  });
}

// 2026-08-04 (API-hit reduction pass) — this was completely uncached: every
// scroll/page-load re-hit Magic Eden fresh, even for the exact same
// collection+offset+limit combo requested by different users seconds
// apart. 30s TTL — short enough that listing/price changes still show up
// quickly, long enough to absorb the common case of several users browsing
// the same popular collection within the same half-minute.
const LISTINGS_TTL_MS = 30_000;

export async function getMagicEdenListings(symbol: string, offset = 0, limit = 20): Promise<NftListing[]> {
  return cached(`magiceden:listings:${symbol}:${offset}:${limit}`, LISTINGS_TTL_MS, async () => {
    const res = await fetchMagicEden(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}/listings?offset=${offset}&limit=${limit}`);
    if (!res.ok) throw new Error(`Magic Eden listings failed (${res.status})`);
    const listings = (await res.json()) as RawMagicEdenListing[];

    return listings.map((l) => ({
      vendor: "magiceden",
      chainFamily: "solana",
      collectionSlug: symbol,
      tokenId: l.tokenMint,
      name: l.token?.name,
      imageUrl: l.token?.image ?? l.extra?.img,
      traits: l.token?.attributes?.map((a) => ({ traitType: a.trait_type, value: a.value })),
      listed: true, // this endpoint only ever returns currently-listed items
      price: l.price.toString(),
      priceCurrency: "SOL",
      seller: l.seller,
      raw: l,
    }));
  });
}

// Raw shape of a buy_now/instructions/sell response — confirmed live 2026-08-03
// against docs.magiceden.io/recipes/sol-list-an-nft.md (list and buy_now
// share the same instruction-response shape): the field to actually use is
// top-level `txSigned.data` (a byte array — ME's response is ALREADY
// partially co-signed, e.g. for OCP royalty-enforcement compliance),
// deserialized client-side as a `VersionedTransaction`, NOT `tx` (unsigned)
// or the nested `v0.*` variants (legacy-wallet fallback, unused here).
interface RawMagicEdenBuyResponse {
  txSigned?: { type: "Buffer"; data: number[] };
  blockhashData?: { blockhash: string; lastValidBlockHeight: number };
}

export interface MagicEdenBuyInstructions {
  // Base64-encoded VersionedTransaction bytes — same encoding/deserialize
  // convention already used for Jupiter's swap transaction (see
  // app/page.tsx's VersionedTransaction.deserialize(Buffer.from(..., "base64"))),
  // so the client reuses that exact same pattern rather than a new one.
  txSignedBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * Builds the unsigned Solana buy_now instructions for a specific listing.
 * REQUIRES MAGICEDEN_API_KEY (Bearer) — confirmed live 2026-07-20 that this
 * endpoint 401s without one, unlike collection/listing reads.
 *
 * 2026-08-03: key re-verified live and IS active (401→400 with real auth,
 * vs 401 for a garbage/missing key — clearly distinguishable now). The
 * earlier "still 401" conclusion was stale. Root cause of the persistent
 * 400 turned out to be a real code bug, not the key/approval status: this
 * endpoint requires `auctionHouseAddress` and we were never sending it.
 * Added `auctionHouse` to RawMagicEdenListing and wired it through below —
 * confirmed live with a real okay_bears listing: 200 OK with a real signed
 * tx buffer.
 * `listing.raw` must be the exact object from getMagicEdenListings — same
 * "replay, don't rebuild" rule as every other quote/listing in this codebase.
 */
export async function getMagicEdenBuyInstructions(params: {
  buyer: string;
  listing: NftListing;
}): Promise<MagicEdenBuyInstructions> {
  if (!MAGICEDEN_API_KEY) {
    throw new Error(
      "MAGICEDEN_API_KEY is not set — required for buy-instruction endpoints (collection browse works without it, buying does not). See .env.example.",
    );
  }
  const raw = params.listing.raw as RawMagicEdenListing;
  const url = new URL(`${MAGICEDEN_API}/instructions/buy_now`);
  url.searchParams.set("buyer", params.buyer);
  url.searchParams.set("seller", raw.seller);
  url.searchParams.set("auctionHouseAddress", raw.auctionHouse);
  url.searchParams.set("tokenMint", raw.tokenMint);
  url.searchParams.set("tokenATA", raw.tokenAddress);
  url.searchParams.set("price", raw.price.toString());
  url.searchParams.set("pdaAddress", raw.pdaAddress);

  const res = await fetchMagicEden(url);
  if (!res.ok) throw new Error(`Magic Eden buy instructions failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as RawMagicEdenBuyResponse;
  if (!body.txSigned?.data || !body.blockhashData) {
    throw new Error("Magic Eden buy instructions response was missing txSigned/blockhashData");
  }
  return {
    txSignedBase64: Buffer.from(body.txSigned.data).toString("base64"),
    blockhash: body.blockhashData.blockhash,
    lastValidBlockHeight: body.blockhashData.lastValidBlockHeight,
  };
}
