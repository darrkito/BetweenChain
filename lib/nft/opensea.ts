import "server-only";
import { encodeFunctionData, concatHex, type Hex } from "viem";
import { cached } from "@/lib/cache";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { NftCollection, NftListing } from "@/lib/nft/types";

const OPENSEA_API = "https://api.opensea.io/api/v2";
// 2026-08-04 (reliability pass) — raised 5min -> 15min, same reasoning as
// lib/nft/magiceden.ts's identical change: name/description/image/floor/
// volume/totalSupply all change slowly, and the buy flow always re-verifies
// a listing immediately before execution regardless of this cache — so a
// display-only figure being up to 15min stale costs nothing real, while
// meaningfully cutting how often this hits OpenSea's 60-reads/min key.
const COLLECTIONS_TTL_MS = 15 * 60_000;

// Header name confirmed live 2026-07-20: an unset/wrong key returns "Invalid
// API key" (401), a fully missing header returns "Missing an API Key" (401).
// Confirmed live which endpoints actually work without a key: ONLY single-
// collection lookup (getOpenSeaCollection) — collection *browse*, listings,
// and buy all require a real key. Apply at https://docs.opensea.io (see
// .env.example).
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

function openseaHeaders(): HeadersInit {
  return OPENSEA_API_KEY ? { "x-api-key": OPENSEA_API_KEY } : {};
}

function requireOpenseaKey() {
  if (!OPENSEA_API_KEY) {
    throw new Error("OPENSEA_API_KEY is not set — required for listings/floor/buy endpoints. See .env.example.");
  }
}

interface RawOpenSeaCollection {
  collection: string; // slug
  name: string;
  description?: string;
  image_url?: string | null;
  banner_image_url?: string | null;
  // Confirmed live 2026-07-20 on the base collection-detail response (not the
  // /stats endpoint, which lacks it) — a true collection-wide item count.
  total_supply?: number;
  // OpenSea's own trust tier — confirmed live 2026-08-04: "verified" is by
  // far the dominant value across both order_by rankings (seven_day_volume
  // AND market_cap), only used to filter browseOpenSeaCollections below.
  safelist_status?: string;
}

interface RawOpenSeaStats {
  total?: { floor_price?: number; floor_price_symbol?: string; volume?: number; num_owners?: number };
  intervals?: Array<{ interval: string; volume?: number }>;
}

function toNftCollection(c: RawOpenSeaCollection, stats?: RawOpenSeaStats, chainId?: number): NftCollection {
  const oneDayVolume = stats?.intervals?.find((i) => i.interval === "one_day")?.volume;
  return {
    vendor: "opensea",
    chainFamily: "evm",
    chainId,
    slug: c.collection,
    name: c.name,
    description: c.description ?? "",
    imageUrl: c.image_url ?? "",
    bannerImageUrl: c.banner_image_url ?? undefined,
    totalSupply: c.total_supply,
    floorPrice: stats?.total?.floor_price?.toString(),
    floorPriceCurrency: stats?.total?.floor_price_symbol,
    numOwners: stats?.total?.num_owners,
    volume24hr: oneDayVolume?.toString(),
    // The stats endpoint's `intervals[].volume` has no currency field of its
    // own — assuming it shares floor_price_symbol (true for any single-chain,
    // single-currency collection, which covers everything this app lists).
    volume24hrCurrency: stats?.total?.floor_price_symbol,
  };
}

async function fetchOpenSeaCollectionsByOrder(chain: string, orderBy: string, limit: number): Promise<RawOpenSeaCollection[]> {
  const url = new URL(`${OPENSEA_API}/collections`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("chain", chain);
  url.searchParams.set("order_by", orderBy);
  const res = await fetchWithTimeout(url, { headers: openseaHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`OpenSea collections list failed (${res.status})`);
  const body = (await res.json()) as { collections: RawOpenSeaCollection[] };
  return body.collections;
}

/**
 * Browse collections. `chain` is OpenSea's own chain-slug (e.g. "ethereum",
 * "matic", "base") — NOT a numeric chain id. REQUIRES OPENSEA_API_KEY —
 * corrected 2026-07-20: an initial live test appeared to succeed keyless, but
 * a clean re-test 401'd ("Missing an API Key") — the first pass's apparent
 * success was not reproducible and shouldn't be trusted; this endpoint needs
 * a key like every other OpenSea endpoint except getOpenSeaCollection below.
 * Full chain-slug list not yet mapped against Relay's numeric chain ids
 * (needed before this can be wired into the cross-chain buy flow) — see
 * PLAN.md's open architecture questions.
 *
 * Defaults to chain="ethereum" — a real bug found live 2026-07-20: with no
 * chain/order_by, OpenSea's default ordering returns essentially
 * arbitrary/spam collections (raw contract addresses as names, null images,
 * random chains like avalanche) instead of anything real.
 *
 * Real gap found live 2026-08-04 (same root cause as the identical Magic
 * Eden fix, see lib/nft/magiceden.ts's browseMagicEdenCollections doc):
 * fetching by `order_by=seven_day_volume` ONLY meant genuine blue chips
 * with high value but lower recent trading volume (Otherdeed, CloneX,
 * Moonbirds, Meebits, Bored Ape Kennel Club, Cool Cats — confirmed live,
 * none of these appeared in a volume-only top-15) never appeared at all.
 * OpenSea's API has no `floor_price` order_by (confirmed live, 400s as
 * unsupported — unlike Magic Eden's stats endpoint), but `market_cap` IS
 * supported and correlates with floor price much more than 7-day volume
 * does, revealing a meaningfully different set of collections. Fetches
 * both order_by values in parallel and merges+dedupes by `collection`
 * slug BEFORE the per-collection /stats enrichment below, so the stats
 * call count still stays bounded by the deduped set size, not doubled.
 *
 * `safelist_status` filter added 2026-08-04 (explicit user request, for
 * consistency with Tradeport's/Magic Eden's identical verified-only
 * filters) — checked live: both rankings were already essentially
 * entirely `"verified"` collections, so this is a modest trust/quality
 * tightening rather than a spam fix here.
 */
export async function browseOpenSeaCollections(chain = "ethereum", limit = 20): Promise<NftCollection[]> {
  requireOpenseaKey();
  return cached(`opensea:collections:${chain}:${limit}`, COLLECTIONS_TTL_MS, async () => {
    const [byVolume, byMarketCap] = await Promise.all([
      fetchOpenSeaCollectionsByOrder(chain, "seven_day_volume", limit),
      fetchOpenSeaCollectionsByOrder(chain, "market_cap", limit),
    ]);
    const bySlug = new Map<string, RawOpenSeaCollection>();
    for (const c of [...byVolume, ...byMarketCap]) {
      if (c.safelist_status === "verified" && !bySlug.has(c.collection)) bySlug.set(c.collection, c);
    }
    const collections = Array.from(bySlug.values());

    // The browse list itself carries only name/image/description — confirmed
    // live 2026-07-21 (no floor_price/volume/total_supply on this endpoint at
    // all, unlike the single-collection detail path getOpenSeaCollection
    // already enriches with /stats). A ranked "top collections by volume"
    // table is the whole point of this endpoint's caller
    // (NftCollectionsTable) — without this, every Floor/Volume cell would be
    // a blank "—", defeating it entirely. One /stats call per collection —
    // bounded by the deduped set size (up to 2x `limit`, so up to ~40) —
    // total_supply/listed count are deliberately NOT fetched here — those
    // need the base collection-detail endpoint and (for listed count) an
    // expensive multi-page scan respectively; too costly to do for a whole
    // page of collections at once. Those stay per-collection, on the detail
    // page.
    //
    // 2026-08-04 (API-hit reduction pass) — this used to fire all ~40 calls
    // via a single Promise.all, a burst that could nearly exhaust OpenSea's
    // 60-reads/min budget in one shot on a cache-miss. mapWithConcurrency
    // caps it at 5 in flight at once — same total call count (still need
    // every collection's stats), spread out instead of bursted, cutting the
    // odds of tripping the rate limit from the burst shape itself.
    const stats = await mapWithConcurrency(collections, 5, (c) =>
      fetchWithTimeout(`${OPENSEA_API}/collections/${encodeURIComponent(c.collection)}/stats`, { headers: openseaHeaders(), cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<RawOpenSeaStats>) : undefined))
        .catch(() => undefined),
    );

    return collections.map((c, i) => toNftCollection(c, stats[i]));
  });
}

export async function getOpenSeaCollection(slug: string): Promise<NftCollection | undefined> {
  return cached(`opensea:collection:${slug}`, COLLECTIONS_TTL_MS, async () => {
    const [collectionRes, statsRes] = await Promise.all([
      fetchWithTimeout(`${OPENSEA_API}/collections/${encodeURIComponent(slug)}`, { headers: openseaHeaders(), cache: "no-store" }),
      // /stats requires OPENSEA_API_KEY (confirmed live 2026-07-20) — the
      // base collection lookup above does not. Missing/failed stats degrade
      // gracefully to undefined floor/volume/owners, not a hard failure —
      // the collection itself (name/image/description/totalSupply) is still
      // useful without them.
      fetchWithTimeout(`${OPENSEA_API}/collections/${encodeURIComponent(slug)}/stats`, { headers: openseaHeaders(), cache: "no-store" }),
    ]);
    if (!collectionRes.ok) return undefined;
    const c = (await collectionRes.json()) as RawOpenSeaCollection;
    const stats = statsRes.ok ? ((await statsRes.json()) as RawOpenSeaStats) : undefined;
    return toNftCollection(c, stats);
  });
}

interface RawOpenSeaListing {
  order_hash: string;
  chain: string;
  price: { current: { value: string; currency: string; decimals: number } };
  // Seaport order — replayed verbatim into fulfillment. `parameters.offerer`
  // is the seller; there is NO top-level `maker` field (an earlier version of
  // this file assumed one — see STATE.md's bug note for how that was caught).
  protocol_data: { parameters: { offerer: string } };
  protocol_address: string;
  asset: { identifier: string; contract: string };
}

interface RawOpenSeaNft {
  name?: string;
  image_url?: string;
  traits?: Array<{ trait_type: string; value: string | number }>;
}

// The listings endpoint (below) returns ONLY order-book data — price, seller,
// contract/tokenId — no name or image. Confirmed live 2026-07-20 (a real bug
// the user hit: listing cards rendered with no artwork at all). Metadata has
// to come from a separate per-NFT call. Cached with a long TTL since an NFT's
// name/image essentially never change post-mint.
const NFT_METADATA_TTL_MS = 60 * 60_000;

export async function getOpenSeaNftMetadata(chain: string, contract: string, identifier: string): Promise<RawOpenSeaNft | undefined> {
  return cached(`opensea:nft:${chain}:${contract}:${identifier}`, NFT_METADATA_TTL_MS, async () => {
    const res = await fetchWithTimeout(`${OPENSEA_API}/chain/${chain}/contract/${contract}/nfts/${identifier}`, {
      headers: openseaHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { nft: RawOpenSeaNft };
    return body.nft;
  });
}

export interface OpenSeaPage {
  listings: NftListing[];
  nextCursor?: string;
}

/**
 * REQUIRES OPENSEA_API_KEY — confirmed live 2026-07-20 that this 401s
 * without one ("Missing an API Key"), unlike collection browse/detail.
 * Cursor-paginated (`cursor` -> OpenSea's own `next` token) for infinite
 * scroll — each page costs 1 + (page size) API calls against the rate limit
 * (the per-NFT metadata enrichment below), so keep page sizes modest.
 * `order_by=unit_price` (confirmed live, ascending) — a real bug: without it
 * the grid showed listings in an arbitrary order, so the actual cheapest item
 * in the collection often wasn't even on the first page, making the
 * displayed "Floor Price" stat look disconnected from what a buyer could
 * actually find while browsing.
 */
export async function getOpenSeaListings(slug: string, limit = 20, cursor?: string): Promise<OpenSeaPage> {
  requireOpenseaKey();
  const url = new URL(`${OPENSEA_API}/listings/collection/${encodeURIComponent(slug)}/all`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order_by", "unit_price");
  if (cursor) url.searchParams.set("next", cursor);
  const res = await fetchWithTimeout(url, { headers: openseaHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`OpenSea listings failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { listings: RawOpenSeaListing[]; next?: string };

  // 2026-08-04 (API-hit reduction pass) — this is a real N+1: one
  // getOpenSeaNftMetadata call per listing (up to `limit`, default 20),
  // fired all at once. getOpenSeaNftMetadata is itself cached (1hr TTL, see
  // NFT_METADATA_TTL_MS above) so repeat views of the same NFT are free —
  // this only matters on a cold cache-miss burst, which is exactly the
  // default first-page-load case every collection page hits.
  // mapWithConcurrency caps it at 5 in flight instead of bursting all 20 at
  // once, same total call count, spread out to cut 429 risk.
  const listings = await mapWithConcurrency(body.listings, 5, async (l) => {
    const amount = BigInt(l.price.current.value);
    const formatted = (Number(amount) / 10 ** l.price.current.decimals).toString();
    const nft = await getOpenSeaNftMetadata(l.chain, l.asset.contract, l.asset.identifier);
    return {
      vendor: "opensea" as const,
      chainFamily: "evm" as const,
      collectionSlug: slug,
      tokenId: l.asset.identifier,
      name: nft?.name,
      imageUrl: nft?.image_url,
      traits: nft?.traits?.map((t) => ({ traitType: t.trait_type, value: String(t.value) })),
      listed: true,
      price: formatted,
      priceCurrency: l.price.current.currency,
      seller: l.protocol_data.parameters.offerer,
      raw: l,
    };
  });
  return { listings, nextCursor: body.next };
}

const LISTED_COUNT_TTL_MS = 10 * 60_000;
// 20 pages * 100/page = up to 2000 unique tokens tracked before giving up and
// marking the result approximate — bounds worst-case latency/cost for a
// single stat on a highly liquid collection. Deliberately the RAW listings
// endpoint (no per-NFT metadata enrichment, unlike getOpenSeaListings) since
// we only need identifiers here, not images/names/traits — keeps this ~5-10x
// cheaper per page than the buy-grid fetch.
const LISTED_COUNT_MAX_PAGES = 20;

export interface OpenSeaListedCount {
  count: number;
  approximate: boolean;
  // The true cheapest currently-fetchable listing, computed from this same
  // scan — NOT OpenSea's own /stats floor_price. Confirmed live 2026-07-20
  // that the two can genuinely disagree (stats reported 4.14999999999999 ETH
  // for Pudgy Penguins; the actual cheapest listing returned by their own
  // listings endpoint, sorted ascending, was 4.277 ETH — a real discrepancy
  // in OpenSea's own data, likely stats lagging a sold/cancelled listing, not
  // a bug on our side). Using our own scan keeps the displayed floor
  // internally consistent with what a buyer actually sees in the grid.
  floorPrice?: string;
  floorPriceCurrency?: string;
}

/**
 * OpenSea's API has no total-active-listings field anywhere (confirmed live
 * 2026-07-20, see STATE.md — grepped the full collection + stats responses).
 * Computed here instead by paginating the raw listings endpoint at limit=100,
 * sorted `order_by=unit_price` ascending, counting UNIQUE token identifiers —
 * not raw listing entries, since the same token can have more than one active
 * order simultaneously (confirmed live: the #8713 duplicate-listing bug
 * report, see app/nft/[vendor]/[slug]/page.tsx's dedupeListings). Counting
 * entries would overcount actual listed items. The ascending sort also means
 * the first page's first item is the true floor — captured here instead of
 * trusting /stats (see OpenSeaListedCount's floorPrice comment). Cached for
 * 10 minutes — this is real cost (up to 20 sequential API calls against a
 * 60-reads/min key), not something to recompute per view. Deliberately NOT
 * called from getOpenSeaCollection — this must stay a separate, non-blocking
 * fetch (see app/api/nft/listed-count/route.ts) so a slow/uncached count
 * never blocks the main collection page from rendering.
 */
export async function countOpenSeaListedItems(slug: string): Promise<OpenSeaListedCount> {
  requireOpenseaKey();
  return cached(`opensea:listedcount:${slug}`, LISTED_COUNT_TTL_MS, async () => {
    const uniqueTokenIds = new Set<string>();
    let floorPrice: string | undefined;
    let floorPriceCurrency: string | undefined;
    let cursor: string | undefined;
    for (let page = 0; page < LISTED_COUNT_MAX_PAGES; page++) {
      const url = new URL(`${OPENSEA_API}/listings/collection/${encodeURIComponent(slug)}/all`);
      url.searchParams.set("limit", "100");
      url.searchParams.set("order_by", "unit_price");
      if (cursor) url.searchParams.set("next", cursor);
      const res = await fetchWithTimeout(url, { headers: openseaHeaders(), cache: "no-store" });
      if (!res.ok) throw new Error(`OpenSea listed-count failed (${res.status}): ${await res.text()}`);
      const body = (await res.json()) as { listings: RawOpenSeaListing[]; next?: string };
      if (page === 0 && body.listings[0]) {
        const first = body.listings[0].price.current;
        floorPrice = (Number(BigInt(first.value)) / 10 ** first.decimals).toString();
        floorPriceCurrency = first.currency;
      }
      for (const l of body.listings) uniqueTokenIds.add(l.asset.identifier);
      if (!body.next) return { count: uniqueTokenIds.size, approximate: false, floorPrice, floorPriceCurrency };
      cursor = body.next;
    }
    return { count: uniqueTokenIds.size, approximate: true, floorPrice, floorPriceCurrency };
  });
}

interface RawOpenSeaAsset {
  identifier: string;
  contract: string;
  name?: string;
  image_url?: string;
  traits?: Array<{ trait_type: string; value: string | number }>;
}

/**
 * Full collection inventory regardless of listing status — `/collection/
 * {slug}/nfts`, confirmed live 2026-07-20 to return name/image/traits inline
 * (no per-item metadata call needed, unlike the listings path above — this
 * is actually cheaper per item). Every item comes back `listed: false` with
 * no price, since this endpoint carries no listing/order data at all — it is
 * NOT cross-referenced against active listings, so "All" view in the UI
 * intentionally shows every item as unlisted/no-price rather than claiming
 * to know which happen to also be for sale (that would need one more API
 * call per page and isn't built yet).
 */
export async function getOpenSeaAllAssets(slug: string, limit = 20, cursor?: string): Promise<OpenSeaPage> {
  requireOpenseaKey();
  const url = new URL(`${OPENSEA_API}/collection/${encodeURIComponent(slug)}/nfts`);
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("next", cursor);
  const res = await fetchWithTimeout(url, { headers: openseaHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`OpenSea collection assets failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { nfts: RawOpenSeaAsset[]; next?: string };

  const listings: NftListing[] = body.nfts.map((n) => ({
    vendor: "opensea",
    chainFamily: "evm",
    collectionSlug: slug,
    tokenId: n.identifier,
    name: n.name,
    imageUrl: n.image_url,
    traits: n.traits?.map((t) => ({ traitType: t.trait_type, value: String(t.value) })),
    listed: false,
  }));
  return { listings, nextCursor: body.next };
}

interface BasicOrderParameters {
  considerationToken: Hex;
  considerationIdentifier: string;
  considerationAmount: string;
  offerer: Hex;
  zone: Hex;
  offerToken: Hex;
  offerIdentifier: string;
  offerAmount: string;
  basicOrderType: number;
  startTime: string;
  endTime: string;
  zoneHash: Hex;
  salt: string;
  offererConduitKey: Hex;
  fulfillerConduitKey: Hex;
  totalOriginalAdditionalRecipients: string;
  additionalRecipients: Array<{ amount: string; recipient: Hex }>;
  signature: Hex;
}

export interface OpenSeaFulfillmentData {
  fulfillment_data: {
    transaction: {
      function: string;
      chain: string;
      to: Hex;
      value: string;
      value_hex: Hex;
      input_data: { parameters: BasicOrderParameters };
      calldata_suffix?: Hex;
    };
  };
}

/**
 * Returns the signed Seaport fulfillment data (order params + signature)
 * needed to execute a buy on-chain — REQUIRES OPENSEA_API_KEY. `listing.raw`
 * must be the exact object from getOpenSeaListings, replayed verbatim (same
 * rule as every other quote/listing replay in this codebase).
 * Docs: https://docs.opensea.io/reference/generate_listing_fulfillment_data_v2
 *
 * ALWAYS a fresh call, never cached — this doubles as the "is this listing
 * still real" re-check: OpenSea rejects fulfillment_data requests for a
 * listing that's been sold/cancelled/expired since it was first quoted, so
 * calling this immediately before building the buy call is the mechanism
 * that closes the listing-staleness gap flagged since the first NFT
 * research pass (see PLAN.md).
 */
export async function getOpenSeaFulfillmentData(params: {
  listing: NftListing;
  fulfillerAddress: string;
}): Promise<OpenSeaFulfillmentData> {
  requireOpenseaKey();
  const raw = params.listing.raw as RawOpenSeaListing;
  const res = await fetchWithTimeout(`${OPENSEA_API}/listings/fulfillment_data`, {
    method: "POST",
    headers: { "content-type": "application/json", ...openseaHeaders() },
    body: JSON.stringify({
      listing: { hash: raw.order_hash, chain: raw.chain, protocol_address: raw.protocol_address },
      fulfiller: { address: params.fulfillerAddress },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    // A real bug found live 2026-07-20: OpenSea returns the SAME status
    // (400) both for "order not found" (a genuinely gone listing) AND for
    // unrelated rejections like "Account can not perform trading operations"
    // (confirmed live against a fulfiller address their compliance
    // screening flagged) — there is no separate status code to distinguish
    // them. Blindly treating every non-ok response as "listing unavailable"
    // silently mislabeled that second case, which would have shown a buyer
    // a confusing "this listing sold" message when the real problem was
    // their own wallet being rejected. Only classify as listing-unavailable
    // when the message actually says so; anything else throws the real
    // OpenSea error text instead of a relabeled guess.
    if (/order not found/i.test(body)) {
      throw new OpenSeaListingUnavailableError(`OpenSea fulfillment data failed (${res.status}): ${body}`);
    }
    throw new Error(`OpenSea fulfillment data failed (${res.status}): ${body}`);
  }
  return res.json();
}

export class OpenSeaListingUnavailableError extends Error {}

// Seaport 1.6's gas-optimized "efficient" fulfillment function — a
// deliberately gas-mined vanity selector (0x00000000, confirmed against
// 4byte.directory's public signature database 2026-07-20, not a bug) that
// takes a single BasicOrderParameters tuple. `calldata_suffix` is Seaport's
// own optimizer-appended trailer, concatenated after the standard ABI
// encoding — both required together to reproduce the exact calldata a
// direct Seaport SDK call would produce. Validated live 2026-07-20 against a
// real listing: Relay's /quote/v2 accepted the resulting {to,value,data} as
// a `txs` destination call and returned a currencyOut.amount matching the
// listing price to the wei — see STATE.md 2026-07-20n.
const BASIC_ORDER_ABI = [
  {
    type: "function",
    name: "fulfillBasicOrder_efficient_6GL6yc",
    stateMutability: "payable",
    inputs: [
      {
        name: "parameters",
        type: "tuple",
        components: [
          { name: "considerationToken", type: "address" },
          { name: "considerationIdentifier", type: "uint256" },
          { name: "considerationAmount", type: "uint256" },
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "offerToken", type: "address" },
          { name: "offerIdentifier", type: "uint256" },
          { name: "offerAmount", type: "uint256" },
          { name: "basicOrderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "offererConduitKey", type: "bytes32" },
          { name: "fulfillerConduitKey", type: "bytes32" },
          { name: "totalOriginalAdditionalRecipients", type: "uint256" },
          {
            name: "additionalRecipients",
            type: "tuple[]",
            components: [
              { name: "amount", type: "uint256" },
              { name: "recipient", type: "address" },
            ],
          },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface OpenSeaBuyCall {
  to: Hex;
  value: string; // wei, decimal string
  data: Hex;
}

/**
 * Fetches a FRESH fulfillment quote (see getOpenSeaFulfillmentData's
 * doc — this is the staleness re-check) and ABI-encodes it into a ready-to-
 * send EVM call: usable directly as an EvmStepData-style transaction for a
 * same-chain buy, or as a single entry in Relay's `txs` array for a
 * cross-chain buy (see lib/chains/relay.ts's getRelayCallQuote).
 */
export async function getOpenSeaBuyCall(params: { listing: NftListing; fulfillerAddress: string }): Promise<OpenSeaBuyCall> {
  const fulfillment = await getOpenSeaFulfillmentData(params);
  const tx = fulfillment.fulfillment_data.transaction;
  const p = tx.input_data.parameters;

  const encoded = encodeFunctionData({
    abi: BASIC_ORDER_ABI,
    functionName: "fulfillBasicOrder_efficient_6GL6yc",
    args: [
      {
        considerationToken: p.considerationToken,
        considerationIdentifier: BigInt(p.considerationIdentifier),
        considerationAmount: BigInt(p.considerationAmount),
        offerer: p.offerer,
        zone: p.zone,
        offerToken: p.offerToken,
        offerIdentifier: BigInt(p.offerIdentifier),
        offerAmount: BigInt(p.offerAmount),
        basicOrderType: p.basicOrderType,
        startTime: BigInt(p.startTime),
        endTime: BigInt(p.endTime),
        zoneHash: p.zoneHash,
        salt: BigInt(p.salt),
        offererConduitKey: p.offererConduitKey,
        fulfillerConduitKey: p.fulfillerConduitKey,
        totalOriginalAdditionalRecipients: BigInt(p.totalOriginalAdditionalRecipients),
        additionalRecipients: p.additionalRecipients.map((r) => ({ amount: BigInt(r.amount), recipient: r.recipient })),
        signature: p.signature,
      },
    ],
  });

  const data = tx.calldata_suffix ? concatHex([encoded, tx.calldata_suffix]) : encoded;

  return { to: tx.to, value: BigInt(tx.value_hex).toString(), data };
}
