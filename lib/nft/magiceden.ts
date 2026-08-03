import "server-only";
import { cached } from "@/lib/cache";
import type { NftCollection, NftListing } from "@/lib/nft/types";

const MAGICEDEN_API = "https://api-mainnet.magiceden.dev/v2";
const COLLECTIONS_TTL_MS = 5 * 60_000;

// Only needed for the buy-instruction endpoints (see getMagicEdenBuyInstructions
// below) — collection browse/listings/stats reads are public, confirmed live
// 2026-07-20 (no key required, ~120 req/min rate limit applies regardless).
const MAGICEDEN_API_KEY = process.env.MAGICEDEN_API_KEY;

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

interface RawMagicEdenListing {
  pdaAddress: string;
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

/**
 * Magic Eden has no full-text collection search endpoint in its public API
 * (confirmed live 2026-07-20 — /v2/collections only paginates, no `term`/`q`
 * param). Browse-only for now; exact-symbol lookup via getMagicEdenCollection
 * covers the "user pastes/knows a collection" case.
 */
export async function browseMagicEdenCollections(offset = 0, limit = 20): Promise<NftCollection[]> {
  // ME's public API rejects offset/limit combinations that aren't clean
  // multiples of each other (confirmed live: a limit=2 request 400'd with
  // "offset and limit must be a multiple of 20, offset must be a multiple of
  // the limit") — always request in pages of 20.
  const pageLimit = 20;
  return cached(`magiceden:collections:${offset}:${pageLimit}`, COLLECTIONS_TTL_MS, async () => {
    const res = await fetch(`${MAGICEDEN_API}/collections?offset=${offset}&limit=${pageLimit}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Magic Eden collections list failed (${res.status})`);
    const collections = (await res.json()) as RawMagicEdenCollection[];
    return collections.slice(0, limit).map((c) => toNftCollection(c));
  });
}

export async function getMagicEdenCollection(symbol: string): Promise<NftCollection | undefined> {
  return cached(`magiceden:collection:${symbol}`, COLLECTIONS_TTL_MS, async () => {
    const [collectionRes, statsRes] = await Promise.all([
      fetch(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}`, { cache: "no-store" }),
      fetch(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}/stats`, { cache: "no-store" }),
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
  const res = await fetch(`${MAGICEDEN_API}/collections/${encodeURIComponent(symbol)}/listings?offset=${offset}&limit=${limit}`, {
    cache: "no-store",
  });
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

export interface MagicEdenBuyInstructions {
  // Base64/hex-encoded raw Solana instructions, same shape Relay already
  // returns for its own Solana steps (lib/chains/relay.ts's SolanaStepData) —
  // reuse lib/client/relayTransaction.ts's instruction-building code rather
  // than writing a parallel implementation, once this is wired into the UI.
  txSigned?: string;
  tx?: unknown;
}

/**
 * Builds the unsigned Solana buy_now instructions for a specific listing.
 * REQUIRES MAGICEDEN_API_KEY (Bearer) — confirmed live 2026-07-20 that this
 * endpoint 401s without one, unlike collection/listing reads. A real key was
 * added to .env.local 2026-08-03, but it still 401s (same as no key / a
 * garbage key — the endpoint gives no distinguishing error). Re-tested again
 * after the 24-48h activation window ME quoted the user had fully passed —
 * still 401, identical to a garbage key, no change. That rules out "just
 * needs more time"; the Airtable approval form
 * (linked from docs.magiceden.io/reference/solana-api-keys — US:
 * airtable.com/appe8frCT8yj415Us/pagDL0gFwzsrLUxIB/form, non-US:
 * .../pagqgEFcpBlbm2DAF/form) is the actual next step now, not another wait.
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
  url.searchParams.set("tokenMint", raw.tokenMint);
  url.searchParams.set("tokenATA", raw.tokenAddress);
  url.searchParams.set("price", raw.price.toString());
  url.searchParams.set("pdaAddress", raw.pdaAddress);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${MAGICEDEN_API_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Magic Eden buy instructions failed (${res.status}): ${await res.text()}`);
  return res.json();
}
