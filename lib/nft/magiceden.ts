import "server-only";
import { cached } from "@/lib/cache";
import type { NftCollection, NftListing } from "@/lib/nft/types";

const MAGICEDEN_API = "https://api-mainnet.magiceden.dev/v2";
// Undocumented but public (no API key needed, confirmed live 2026-08-03) —
// this is what magiceden.io's own site calls to render its home page
// "Popular collections" ranking. See browseMagicEdenCollections below for
// why the documented v2 /collections endpoint can't be used for this.
const MAGICEDEN_STATS_API = "https://stats-mainnet.magiceden.io";
const COLLECTIONS_TTL_MS = 5 * 60_000;

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
 * per-minute window — a request that lands right at the edge of someone
 * else's burst has a good chance of succeeding a moment later, so a single
 * short-backoff retry meaningfully cuts user-visible 429s without masking a
 * sustained outage (only ever retries once; a second 429 still surfaces as a
 * real error). Real bug found live 2026-08-03: opening a collection page
 * would hard-fail on a transient 429 with no retry at all.
 */
async function fetchMagicEden(url: string | URL, retryDelayMs = 800): Promise<Response> {
  const res = await fetch(url, { headers: magicEdenHeaders(), cache: "no-store" });
  if (res.status !== 429) return res;
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  return fetch(url, { headers: magicEdenHeaders(), cache: "no-store" });
}

interface RawMagicEdenCollection {
  symbol: string;
  name: string;
  description?: string;
  image?: string;
}

interface RawMagicEdenStats {
  symbol: string;
  floorPrice?: number; // lamports
  listedCount?: number;
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
  token?: { name?: string; image?: string; attributes?: Array<{ trait_type: string; value: string }> };
}

function toNftCollection(c: RawMagicEdenCollection, stats?: RawMagicEdenStats): NftCollection {
  return {
    vendor: "magiceden",
    chainFamily: "solana",
    slug: c.symbol,
    name: c.name,
    description: c.description ?? "",
    imageUrl: c.image ?? "",
    floorPrice: stats?.floorPrice != null ? (stats.floorPrice / 1e9).toString() : undefined,
    floorPriceCurrency: "SOL",
    listedCount: stats?.listedCount,
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
export async function browseMagicEdenCollections(limit = 20): Promise<NftCollection[]> {
  return cached(`magiceden:top-collections:${limit}`, COLLECTIONS_TTL_MS, async () => {
    const [byVolume, byFloor] = await Promise.all([
      fetchMagicEdenTopCollectionsBySort("volume", limit),
      fetchMagicEdenTopCollectionsBySort("floorPrice", limit),
    ]);
    const bySymbol = new Map<string, RawMagicEdenTopCollection>();
    for (const row of [...byVolume, ...byFloor]) {
      if (row.isVerified && !bySymbol.has(row.collectionSymbol)) bySymbol.set(row.collectionSymbol, row);
    }
    return Array.from(bySymbol.values()).map(toNftCollectionFromStats);
  });
}

export async function getMagicEdenCollection(symbol: string): Promise<NftCollection | undefined> {
  return cached(`magiceden:collection:${symbol}`, COLLECTIONS_TTL_MS, async () => {
    const [collectionRes, statsRes] = await Promise.all([
      fetchMagicEden(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}`),
      fetchMagicEden(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}/stats`),
    ]);
    // Only a real 404 means "no such collection" — any other non-ok status
    // (e.g. 429 from ME's aggressive ~120 req/min keyless rate limit,
    // confirmed live 2026-07-20) must surface as an error, not be silently
    // swallowed into "not found" (a real bug this exact confusion caused
    // during live verification — see STATE.md).
    if (collectionRes.status === 404) return undefined;
    if (!collectionRes.ok) throw new Error(`Magic Eden collection lookup failed (${collectionRes.status})`);
    const collection = (await collectionRes.json()) as RawMagicEdenCollection;
    const stats = statsRes.ok ? ((await statsRes.json()) as RawMagicEdenStats) : undefined;
    return toNftCollection(collection, stats);
  });
}

export async function getMagicEdenListings(symbol: string, offset = 0, limit = 20): Promise<NftListing[]> {
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
