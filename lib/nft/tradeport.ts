import "server-only";
import { cached } from "@/lib/cache";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import type { NftCollection, NftListing, OwnedNft } from "@/lib/nft/types";

const TRADEPORT_API = "https://api.indexer.xyz/graphql";
const TRADEPORT_API_KEY = process.env.TRADEPORT_API_KEY;
const TRADEPORT_API_USER = process.env.TRADEPORT_API_USER;

// VERIFIED live 2026-07-21 against the demo key (10,000 calls / 2-week trial —
// see .env.example). Two things the docs don't make obvious:
// 1. Full GraphQL introspection (__type, arbitrary field probing) is blocked by
//    a gateway allow-list in front of Hasura — every disallowed shape returns
//    the generic "Invalid GraphQL query", including syntactically valid ones.
//    Only a narrow set of pre-registered operations pass through.
// 2. Per-chain data is namespaced under a root field matching the chain name
//    (`sui { collections { ... } }`), NOT a `${chain}_collections` prefix as
//    Tradeport's own Hasura-convention docs suggest. Confirmed for sui, aptos,
//    movement. Listing price/seller live on a separate `listings` type (not on
//    `nfts` — `nfts.listed` is a bool flag only), filterable by nested
//    `collection: { slug: { _eq } } }`.

export type TradeportChain = "sui" | "aptos" | "movement";

// Single source of truth for "is this string actually a valid TradeportChain"
// — exported so every route validates against the same list instead of each
// hand-rolling its own duplicate array (app/api/nft/collections/route.ts had
// one before this; app/api/nft/collection and .../listings had none at all,
// just an unchecked `as TradeportChain` cast). That unchecked cast is a real
// injection risk, not just a type-safety nicety: `chain` is interpolated
// directly into the GraphQL query string as a field selector (see
// COLLECTIONS_QUERY below, `${chain} { collections { ... } } }`) — an
// unvalidated query-param value would be injected verbatim into the GraphQL
// query sent to Tradeport's API.
export const TRADEPORT_CHAINS: readonly TradeportChain[] = ["sui", "aptos", "movement"];

export function isTradeportChain(value: string): value is TradeportChain {
  return (TRADEPORT_CHAINS as readonly string[]).includes(value);
}

// Sui: MIST, 9 decimals (confirmed live 2026-07-21 — Fuddies floor=15000000000
// raw = 15 SUI, matches known market floor). Aptos: Octas, 8 decimals
// (confirmed — Aptos Monkeys floor=1499990000 raw = 14.9999 APT). Movement is
// an Aptos-derived Move VM and uses the same 8-decimal Octas convention for
// its native MOVE token — NOT independently verified against live data (no
// active Movement listings found to cross-check), so treat with slightly less
// confidence than the other two.
const CHAIN_DECIMALS: Record<TradeportChain, number> = { sui: 9, aptos: 8, movement: 8 };
const CHAIN_CURRENCY: Record<TradeportChain, string> = { sui: "SUI", aptos: "APT", movement: "MOVE" };

function fromAtomic(raw: number | string | null | undefined, decimals: number): string | undefined {
  if (raw == null) return undefined;
  return (Number(raw) / 10 ** decimals).toString();
}

// Tradeport's cover_url/media_url come back as raw `ipfs://<cid>` OR
// `walrus://<blobId>` URIs on real collections (confirmed live: Fuddies'
// cover_url is ipfs://, Popkins' is walrus://) — browsers have no native
// resolver for either scheme, so NftImage would silently fail to load
// these without a gateway rewrite. ipfs.io and Walrus's own public mainnet
// aggregator (docs.wal.app/docs/network-reference, confirmed live 2026-07-22
// via a real request) are the standard public gateways for each; swap for
// dedicated infra before real traffic if load times matter.
//
// Walrus blobs can genuinely expire (its storage model is NOT permanent by
// default — data is stored for a paid number of epochs and can be garbage
// collected after) — confirmed live 2026-07-22: Popkins' own walrus://
// cover blob 404s from Walrus's own aggregator with "BLOB_NOT_FOUND", not a
// gateway/rewrite problem. See enrichCollection's imageUrl fallback for how
// that's handled — this function can only fix the URL SCHEME, not recover
// data that's actually gone from the network.
function toHttpUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}`;
  if (url.startsWith("walrus://")) return `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${url.slice("walrus://".length)}`;
  return url;
}

function requireTradeportKey() {
  if (!TRADEPORT_API_KEY || !TRADEPORT_API_USER) {
    throw new Error(
      "TRADEPORT_API_KEY / TRADEPORT_API_USER not set — Tradeport denies all requests (even introspection) " +
        "without both. See .env.example. Also see the UNVERIFIED note at the top of this file — query shapes " +
        "need correcting against the real schema now that a key exists.",
    );
  }
}

async function tradeportQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  requireTradeportKey();
  const res = await fetchWithTimeout(TRADEPORT_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-user": TRADEPORT_API_USER!,
      "x-api-key": TRADEPORT_API_KEY!,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Tradeport GraphQL request failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`Tradeport GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  return body.data as T;
}

// Verified fields (2026-07-21): id, title, slug, semantic_slug, description,
// floor, volume, usd_volume, cover_url, supply, verified, discord, twitter,
// website. `floor`/`volume` are raw atomic units (see CHAIN_DECIMALS) — the
// original draft displayed these unconverted (a 15 SUI floor would have shown
// as "15000000000 SUI"). `listed`/`listed_count` are NOT on collections and
// have no nested aggregate relation either — listed count requires a separate
// `listings_aggregate` call per collection (see below).
//
// `order_by` is a template parameter (not a fixed `{ volume: desc }`) —
// real gap found live 2026-08-04, same root cause as the identical Magic
// Eden fix: sorting by volume alone meant a genuine high-floor collection
// with lower recent trading volume never appeared at all (see
// browseTradeportCollections below). `where: { verified: { _eq: true } }`
// is REQUIRED once floor-sorting is in play, not optional polish — confirmed
// live that unverified `order_by: { floor: desc }` results are dominated by
// spam/scam listings with fabricated floor prices (one row showed a raw
// floor of 944444444000000000 — ~9.4 * 10^8 SUI — with zero volume, not a
// real market price). Filtering to verified collections cleaned this
// completely; applied to BOTH order directions for consistency, not just
// the floor one, since a legitimate top collection should be verified
// either way.
const COLLECTIONS_QUERY = (chain: TradeportChain, orderBy: string) => `
  query Collections($limit: Int!) {
    ${chain} {
      collections(limit: $limit, order_by: { ${orderBy}: desc }, where: { verified: { _eq: true } }) {
        id
        slug
        title
        cover_url
        floor
        supply
        discord
        twitter
        website
      }
    }
  }
`;

// Single-collection lookup by slug (the on-chain address string this app
// already treats as NftCollection.slug, NOT Tradeport's separate human
// semantic_slug) — powers the collection detail page header. Confirmed live
// 2026-07-21: this was previously MISSING entirely (app/api/nft/collection/
// route.ts had no Tradeport branch at all), which meant every Tradeport
// collection detail page 404'd before a buyer could ever see a Buy button.
const COLLECTION_BY_SLUG_QUERY = (chain: TradeportChain) => `
  query Collection($slug: String!) {
    ${chain} {
      collections(where: { slug: { _eq: $slug } }, limit: 1) {
        id
        slug
        title
        cover_url
        floor
        supply
        discord
        twitter
        website
      }
    }
  }
`;

// listings_aggregate must filter price IS NOT NULL — confirmed live: Fuddies
// (a real, active collection) has 12,731 listings rows but only 530 with a
// non-null price. The table apparently retains stale/expired/delisted rows;
// an unfiltered count wildly overstates what's actually for sale.
//
// $collectionId must be `uuid!`, NOT `String!` — a real bug found live
// 2026-07-22 alongside LISTING_BY_ID_QUERY's identical mistake:
// collection_id is a uuid column, and Tradeport's GraphQL validation
// rejects the mismatch outright. This was SILENTLY masked the whole time by
// enrichCollection's `Promise.allSettled` (built for transient failures,
// not a permanent schema mismatch) — every single Tradeport collection's
// `listedCount` has been quietly `undefined` since this file was written,
// never actually succeeding once. Confirmed live: the identical query with
// `uuid!` returns a real count (530 for Fuddies, matching the number
// already known from the listings_aggregate research this comment
// references).
const LISTED_COUNT_QUERY = (chain: TradeportChain) => `
  query ListedCount($collectionId: uuid!) {
    ${chain} {
      listings_aggregate(where: { collection_id: { _eq: $collectionId }, price: { _is_null: false } }) {
        aggregate { count }
      }
    }
  }
`;

// day_volume is in the same raw atomic units as collections.floor/volume.
const DAY_VOLUME_QUERY = (chain: TradeportChain) => `
  query DayVolume($slug: String!) {
    ${chain} {
      collection_stats(slug: $slug) { day_volume }
    }
  }
`;

// CollectionFloorPeriod enum values confirmed live via a deliberate bad-enum
// error: ['days_1','days_7','days_14','days_30','days_60','days_90','all_time'].
// The only field on CollectionFloorValue is `value` (no timestamp) — ordering
// was inferred from a days_7 sample (older→newer: first entry was a distinct
// 7d-ago value, remainder matched the current floor), so element [0] of a
// days_1, limit:2 fetch is treated as "~24h ago". Not a guess: it's the same
// direction Tradeport's own value trend showed across every sample pulled.
const FLOOR_24H_QUERY = (chain: TradeportChain) => `
  query Floor24h($slug: String!) {
    ${chain} {
      collection_floors(slug: $slug, period: days_1, offset: 0, limit: 2) { value }
    }
  }
`;

async function enrichCollection(chain: TradeportChain, c: TradeportCollectionRow): Promise<NftCollection> {
  const decimals = CHAIN_DECIMALS[chain];
  const currency = CHAIN_CURRENCY[chain];

  const [listedCountResult, dayVolumeResult, floor24hResult] = await Promise.allSettled([
    tradeportQuery<{ [K in TradeportChain]?: { listings_aggregate: { aggregate: { count: number } } } }>(
      LISTED_COUNT_QUERY(chain),
      { collectionId: c.id },
    ),
    tradeportQuery<{ [K in TradeportChain]?: { collection_stats: { day_volume: string } | null } }>(DAY_VOLUME_QUERY(chain), {
      slug: c.slug,
    }),
    tradeportQuery<{ [K in TradeportChain]?: { collection_floors: Array<{ value: string }> } }>(FLOOR_24H_QUERY(chain), {
      slug: c.slug,
    }),
  ]);

  const listedCount = listedCountResult.status === "fulfilled" ? listedCountResult.value[chain]?.listings_aggregate.aggregate.count : undefined;
  const dayVolume = dayVolumeResult.status === "fulfilled" ? dayVolumeResult.value[chain]?.collection_stats?.day_volume : undefined;
  const floorHistory = floor24hResult.status === "fulfilled" ? floor24hResult.value[chain]?.collection_floors : undefined;

  let floorChange24hrPct: number | undefined;
  const floorNow = c.floor;
  const floor24hAgo = floorHistory?.[0]?.value != null ? Number(floorHistory[0].value) : undefined;
  if (floorNow != null && floor24hAgo != null && floor24hAgo > 0) {
    floorChange24hrPct = ((floorNow - floor24hAgo) / floor24hAgo) * 100;
  }

  return {
    vendor: "tradeport",
    chainFamily: "move",
    slug: c.slug,
    name: c.title,
    description: "",
    imageUrl: toHttpUrl(c.cover_url),
    floorPrice: fromAtomic(c.floor, decimals),
    floorPriceCurrency: currency,
    listedCount,
    totalSupply: c.supply,
    volume24hr: fromAtomic(dayVolume, decimals),
    volume24hrCurrency: currency,
    floorChange24hrPct,
    externalUrl: c.website ?? undefined,
    twitterUsername: normalizeTwitterHandle(c.twitter),
    discordUrl: c.discord ?? undefined,
  };
}

// Tradeport's `twitter` field format isn't documented and hasn't been seen
// live with a real value yet (2026-08-07) — normalizing defensively so
// NftCollection.twitterUsername stays a bare handle either way (matching
// OpenSea's twitter_username shape), whether Tradeport returns a full URL
// or a bare handle.
function normalizeTwitterHandle(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:x\.com|twitter\.com)\/([^/?]+)/i);
  return (match ? match[1] : value.replace(/^@/, "")) || undefined;
}

// Enrichment (listed count, 24h volume, 24h floor change) costs 3 extra
// GraphQL calls per collection on top of the 1 list call — a 20-collection
// page uses ~61 calls. Same 5-minute TTL convention as OpenSea's
// COLLECTIONS_TTL_MS (lib/nft/opensea.ts) — collection metadata (including
// cover_url, the field a real user report was about, 2026-07-22) barely
// changes minute to minute, so caching this directly addresses both the
// trial-quota-burn concern already flagged here AND "don't call the API
// again for the same data" — no separate image-storage layer needed, this
// caches the Tradeport response (including whatever CDN/Walrus/IPFS link it
// contains) in memory, so a repeat page view serves the same real link
// without a new upstream call.
// 2026-08-04: raised 5min -> 15min, same reasoning as the identical OpenSea/
// Magic Eden change this same pass — collection metadata/floor/volume all
// change slowly, buy flow re-verifies freshness independently at execute
// time, so this is a pure API-hit reduction with no real staleness cost.
const TRADEPORT_COLLECTIONS_TTL_MS = 15 * 60_000;

type TradeportCollectionRow = {
  id: string;
  slug: string;
  title: string;
  cover_url?: string;
  floor?: number;
  supply?: number;
  discord?: string | null;
  twitter?: string | null;
  website?: string | null;
};

async function fetchTradeportCollectionsByOrder(chain: TradeportChain, orderBy: string, limit: number): Promise<TradeportCollectionRow[]> {
  const data = await tradeportQuery<{ [K in TradeportChain]?: { collections: TradeportCollectionRow[] } }>(COLLECTIONS_QUERY(chain, orderBy), {
    limit,
  });
  return data[chain]?.collections ?? [];
}

// Real gap found live 2026-08-04, same root cause as the identical Magic
// Eden fix (see lib/nft/magiceden.ts's browseMagicEdenCollections doc):
// fetching `order_by: { volume: desc }` ONLY meant a genuine high-floor
// collection with lower recent trading volume never appeared at all —
// confirmed live on Sui, `order_by: { floor: desc }` (with `verified: true`,
// see COLLECTIONS_QUERY's doc) surfaced collections like Enforcer Machin,
// Legacy, and Sui Lord that never showed up in a volume-only top-8. Fetches
// both orderings in parallel and merges+dedupes by `slug` BEFORE the
// per-collection enrichment below, so the enrichment call count stays
// bounded by the deduped set size, not doubled.
export async function browseTradeportCollections(chain: TradeportChain, limit = 20): Promise<NftCollection[]> {
  return cached(`tradeport:collections:${chain}:${limit}`, TRADEPORT_COLLECTIONS_TTL_MS, async () => {
    const [byVolume, byFloor] = await Promise.all([
      fetchTradeportCollectionsByOrder(chain, "volume", limit),
      fetchTradeportCollectionsByOrder(chain, "floor", limit),
    ]);
    const bySlug = new Map<string, TradeportCollectionRow>();
    for (const c of [...byVolume, ...byFloor]) {
      if (!bySlug.has(c.slug)) bySlug.set(c.slug, c);
    }
    return Promise.all(Array.from(bySlug.values()).map((c) => enrichCollection(chain, c)));
  });
}

const SEARCH_QUERY = (chain: TradeportChain) => `
  query SearchCollections($pattern: String!, $limit: Int!) {
    ${chain} {
      collections(where: { title: { _ilike: $pattern } }, limit: $limit, order_by: { volume: desc }) {
        id
        slug
        title
        cover_url
        floor
        supply
      }
    }
  }
`;

const SEARCH_TTL_MS = 60_000;

/**
 * Real, universal search by name across ALL of a chain's collections, not
 * limited to the ranked top set browseTradeportCollections returns.
 * Confirmed live 2026-08-05: Tradeport's GraphQL gateway (which blocks most
 * arbitrary query shapes behind an allow-list, see this file's top comment)
 * DOES allow `_ilike` pattern matching on `title` — a genuine Hasura-style
 * case-insensitive substring operator, not something reverse-engineered or
 * guessed. Deliberately NOT verified-only (unlike browseTradeportCollections)
 * — a user searching for a specific name by name wants that exact result
 * even if unverified, not a curated ranking; same reasoning OpenSea's search
 * doesn't apply a trust filter beyond disabled/nsfw either.
 *
 * Deliberately NOT enriched (no listedCount/volume/floorChange24hrPct, unlike
 * browse/detail) — enrichCollection costs 3 extra GraphQL calls per result;
 * for a list of up to `limit` search results a user hasn't committed to
 * clicking into yet, that's not worth the trial-quota cost. Floor price
 * still comes through (already on the base collections query, free).
 */
export async function searchTradeportCollections(chain: TradeportChain, query: string, limit = 20): Promise<NftCollection[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return cached(`tradeport:search:${chain}:${trimmed}:${limit}`, SEARCH_TTL_MS, async () => {
    const decimals = CHAIN_DECIMALS[chain];
    const currency = CHAIN_CURRENCY[chain];
    const data = await tradeportQuery<{ [K in TradeportChain]?: { collections: TradeportCollectionRow[] } }>(SEARCH_QUERY(chain), {
      pattern: `%${trimmed}%`,
      limit,
    });
    const rows = data[chain]?.collections ?? [];
    return rows.map((c) => ({
      vendor: "tradeport" as const,
      chainFamily: "move" as const,
      slug: c.slug,
      name: c.title,
      description: "",
      imageUrl: toHttpUrl(c.cover_url),
      floorPrice: fromAtomic(c.floor, decimals),
      floorPriceCurrency: currency,
      totalSupply: c.supply,
    }));
  });
}

/**
 * Single-collection detail, used by the collection page header — see
 * COLLECTION_BY_SLUG_QUERY's comment for the 404 bug this fixes. Runs the
 * same enrichment (listed count, 24h volume, 24h floor change) as the browse
 * list, at the same 3-extra-calls cost per lookup — same caching reasoning
 * as browseTradeportCollections above.
 */
export async function getTradeportCollection(chain: TradeportChain, slug: string): Promise<NftCollection | undefined> {
  return cached(`tradeport:collection:${chain}:${slug}`, TRADEPORT_COLLECTIONS_TTL_MS, async () => {
    const data = await tradeportQuery<{
      [K in TradeportChain]?: { collections: TradeportCollectionRow[] };
    }>(COLLECTION_BY_SLUG_QUERY(chain), { slug });
    const row = data[chain]?.collections?.[0];
    if (!row) return undefined;
    return enrichCollection(chain, row);
  });
}

// Verified fields (2026-07-21): listings.{id,price,seller,nft_id,market_name,
// collection_id} + nested listings.nft.{name,media_url}. Price is on
// `listings`, not `nfts` (nfts only has a `listed: Boolean` flag). Filtered by
// nested `collection: { slug: { _eq } }` — confirmed valid shape (empty result
// set for a collection with no active listings, no schema error).
//
// `id` (the LISTING's own id, distinct from nft_id) added 2026-07-21 — this
// is what Tradeport's buy SDK (@tradeport/sui-trading-sdk's buyListings)
// actually keys off, and the original query never selected it at all.
//
// `where: { price: { _is_null: false } }` + `order_by: { price: asc }` added
// same day — confirmed live the same way listings_aggregate already needed
// it (see LISTED_COUNT_QUERY's comment): most rows in this table are
// stale/expired with a null price, so an unfiltered fetch mostly returned
// unbuyable rows and (worse) didn't surface the actual cheapest listing
// first. Same fix shape as OpenSea's getOpenSeaListings order_by=unit_price.
const LISTINGS_QUERY = (chain: TradeportChain) => `
  query Listings($slug: String!, $limit: Int!) {
    ${chain} {
      listings(
        where: { collection: { slug: { _eq: $slug } }, price: { _is_null: false } }
        order_by: { price: asc }
        limit: $limit
      ) {
        id
        nft_id
        price
        seller
        nft { name media_url }
      }
    }
  }
`;

// Shorter than TRADEPORT_COLLECTIONS_TTL_MS — listing availability/price
// changes faster than collection metadata. This is purely a browse-display
// cache; the actual purchase flow's staleness guarantee comes from
// isTradeportListingStillActive()/buildVerifiedTradeportBuyTransaction()
// below, which are NEVER cached and always hit Tradeport fresh right
// before a signature is requested — this cache can never make a real
// purchase act on stale data.
const TRADEPORT_LISTINGS_TTL_MS = 2 * 60_000;

export async function getTradeportListings(chain: TradeportChain, slug: string, limit = 20): Promise<NftListing[]> {
  return cached(`tradeport:listings:${chain}:${slug}:${limit}`, TRADEPORT_LISTINGS_TTL_MS, async () => {
    const data = await tradeportQuery<{
      [K in TradeportChain]?: {
        listings: Array<{ id: string; nft_id: string; price: number | null; seller: string | null; nft?: { name?: string; media_url?: string } }>;
      };
    }>(LISTINGS_QUERY(chain), { slug, limit });
    const rows = data[chain]?.listings ?? [];
    const decimals = CHAIN_DECIMALS[chain];
    return rows
      .filter((l) => l.price != null)
      .map((l) => ({
        vendor: "tradeport" as const,
        chainFamily: "move" as const,
        collectionSlug: slug,
        tokenId: l.nft_id,
        name: l.nft?.name,
        imageUrl: toHttpUrl(l.nft?.media_url),
        listed: true,
        price: fromAtomic(l.price, decimals),
        priceCurrency: CHAIN_CURRENCY[chain],
        seller: l.seller ?? undefined,
        // listingId (l.id) is what buyListings() needs — kept on raw rather
        // than a new top-level NftListing field, same "replay the raw
        // vendor payload verbatim" rule as OpenSea's order_hash/
        // protocol_address.
        raw: { ...l, chain, collectionSlug: slug },
      }));
  });
}

// Real, live-verified shape (2026-08-07): `nfts` is queryable directly
// (not just nested under `listings`), filterable by `owner` + a nested
// `collection: { slug: { _eq } }` — confirmed against Tradeport's own
// gateway allow-list with a real (zero-result) test query before being used
// here, same "verify the shape works before building on it" discipline as
// every other Tradeport query in this file.
const OWNED_NFTS_QUERY = (chain: TradeportChain) => `
  query Owned($owner: String!, $slug: String!, $limit: Int!) {
    ${chain} {
      nfts(where: { owner: { _eq: $owner }, collection: { slug: { _eq: $slug } } }, limit: $limit) {
        id
        token_id
        name
        media_url
      }
    }
  }
`;

const OWNED_NFTS_LIMIT = 100;

/** Real NFTs a wallet actually owns from one specific collection — used by
 * the Games Hub's collection-ownership display (2026-08-07). */
export async function getTradeportWalletHoldings(chain: TradeportChain, owner: string, slug: string): Promise<OwnedNft[]> {
  const data = await tradeportQuery<{
    [K in TradeportChain]?: { nfts: Array<{ id: string; token_id?: string; name?: string; media_url?: string }> };
  }>(OWNED_NFTS_QUERY(chain), { owner, slug, limit: OWNED_NFTS_LIMIT });
  const rows = data[chain]?.nfts ?? [];
  return rows.map((n) => ({ tokenId: n.token_id ?? n.id, name: n.name, imageUrl: toHttpUrl(n.media_url) }));
}

// Staleness re-check for a single listing right before building the buy
// transaction — same role as OpenSea's "always fresh, never cached"
// getOpenSeaFulfillmentData call. A listing whose price has gone null since
// it was first shown (sold/cancelled) is reported as gone; the trading SDK's
// own buyListings() call is the final, authoritative check (it will fail
// on-chain for a genuinely gone listing even if this race is lost), but this
// gives a clean, expected "sold" response before ever asking for a signature.
// Real bug found live 2026-07-22 (via a user report — "allegiants.sui"
// listing quote 502ing): `$id: String!` fails Tradeport's own GraphQL
// validation ("variable 'id' is declared as 'String!', but used where
// 'uuid' is expected") — listings.id is a uuid column, not a string one
// (unlike collections.slug, which genuinely is a string). This made EVERY
// Sui NFT quote/execute/confirm-deposit call 502 unconditionally, not just
// this one listing — confirmed live, the exact same query with `$id: uuid!`
// succeeds. Collections' `slug`/`id` filters elsewhere in this file stay
// `String!` (correct there — a Move package address, not a uuid).
const LISTING_BY_ID_QUERY = (chain: TradeportChain) => `
  query ListingById($id: uuid!) {
    ${chain} {
      listings(where: { id: { _eq: $id } }, limit: 1) {
        id
        price
      }
    }
  }
`;

export async function isTradeportListingStillActive(chain: TradeportChain, listingId: string): Promise<boolean> {
  const data = await tradeportQuery<{ [K in TradeportChain]?: { listings: Array<{ id: string; price: number | null }> } }>(
    LISTING_BY_ID_QUERY(chain),
    { id: listingId },
  );
  const row = data[chain]?.listings?.[0];
  return row != null && row.price != null;
}

// Buy execution (@tradeport/sui-trading-sdk's buyListings) lives in
// lib/nft/tradeportBuy.ts, not here — it's a separate client (the "NFT
// Trading SDK", distinct from this file's GraphQL "NFT Data API") with its
// own signing-transaction return shape, confirmed live 2026-07-21 via
// tradeport.xyz/docs/nft-trading-sdk/sui-sdk. Kept in its own file so this
// file stays a pure read-only data client, same separation opensea.ts
// doesn't need (OpenSea's REST API serves both roles itself) but is
// meaningful here since the two Tradeport clients authenticate and shape
// their responses differently.
