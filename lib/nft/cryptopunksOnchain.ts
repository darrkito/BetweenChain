import "server-only";
import { formatEther, zeroAddress } from "viem";
import { getPublicClient } from "@/lib/chains/evm";
import { cached } from "@/lib/cache";
import { getOpenSeaNftMetadata } from "@/lib/nft/opensea";
import { CRYPTOPUNKS_SLUG, type OnchainPunkListingRaw } from "@/lib/nft/cryptopunksShared";
import type { OpenSeaListedCount, OpenSeaPage } from "@/lib/nft/opensea";

// CryptoPunks (0xb47e...193BBB) predates ERC-721/Seaport by years and still
// trades through its own 2017-era native marketplace mechanism baked into
// the contract itself — confirmed live 2026-08-03 via OpenSea's own event
// data (`token_standard: "cryptopunks"`, not `erc721`, on real recent sales)
// after OpenSea's public Listings API (getOpenSeaListings/countOpenSeaListedItems
// in lib/nft/opensea.ts) returned zero results for this collection despite it
// trading actively. Real sales happen; there just aren't any Seaport orders
// to list. This reads live offer state straight from the contract's public
// `punksOfferedForSale` mapping instead — the only way to get real listings
// for this one collection. Every other OpenSea/Ethereum collection goes
// through the normal Seaport path untouched.
const CRYPTOPUNKS_CONTRACT = "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB" as const;
const TOTAL_PUNKS = 10000;
const OFFERS_TTL_MS = 2 * 60_000; // a full 10k-call multicall scan is real RPC cost — don't repeat it per request

const PUNKS_OFFERED_FOR_SALE_ABI = [
  {
    name: "punksOfferedForSale",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "isForSale", type: "bool" },
      { name: "punkIndex", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "minValue", type: "uint256" },
      { name: "onlySellTo", type: "address" },
    ],
  },
] as const;

export interface OnchainPunkOffer {
  punkIndex: number;
  seller: string;
  minValueWei: bigint;
}

// Same tuple shape multicall's `result` carries for this ABI's single
// function: [isForSale, punkIndex, seller, minValue, onlySellTo].
type RawOfferResult =
  | { status: "success"; result: readonly [boolean, bigint, string, bigint, string] }
  | { status: "failure"; result?: undefined };

/**
 * Pure filter+sort step, extracted from fetchPublicOffers below so it's
 * independently unit-testable with synthetic multicall results (no live RPC
 * call needed) — see lib/nft/cryptopunksOnchain.test.ts. Filtered to PUBLIC
 * offers only: `onlySellTo !== zeroAddress` means a gift/escrow transfer
 * restricted to one specific address (confirmed live — every `minValue: 0`
 * offer found had a non-zero `onlySellTo`), not something any buyer could
 * actually act on, so those are excluded rather than shown as free
 * listings. Sorted ascending by price so the cheapest offer is the true
 * floor — confirmed live this exactly matches OpenSea's own displayed floor
 * (32.26 ETH) once the private gifts are excluded.
 */
export function filterAndSortPublicOffers(results: readonly RawOfferResult[]): OnchainPunkOffer[] {
  const offers: OnchainPunkOffer[] = [];
  for (const r of results) {
    if (r.status !== "success") continue;
    const [isForSale, punkIndex, seller, minValue, onlySellTo] = r.result;
    if (!isForSale || onlySellTo !== zeroAddress) continue;
    offers.push({ punkIndex: Number(punkIndex), seller, minValueWei: minValue });
  }
  offers.sort((a, b) => (a.minValueWei < b.minValueWei ? -1 : a.minValueWei > b.minValueWei ? 1 : 0));
  return offers;
}

/**
 * Full live scan of all 10,000 punks' sale-offer state, via viem's
 * `multicall` (batches automatically into a handful of `eth_call`s against
 * the Multicall3 contract — confirmed live ~3-4s total against a public
 * RPC).
 */
async function fetchPublicOffers(): Promise<OnchainPunkOffer[]> {
  return cached(`cryptopunks:onchain:offers`, OFFERS_TTL_MS, async () => {
    const client = getPublicClient(1);
    const contracts = Array.from({ length: TOTAL_PUNKS }, (_, i) => ({
      address: CRYPTOPUNKS_CONTRACT,
      abi: PUNKS_OFFERED_FOR_SALE_ABI,
      functionName: "punksOfferedForSale" as const,
      args: [BigInt(i)] as const,
    }));
    const results = await client.multicall({ contracts, allowFailure: true });
    return filterAndSortPublicOffers(results as unknown as RawOfferResult[]);
  });
}

/**
 * Same page shape as getOpenSeaListings, so the API route can swap this in
 * as a drop-in replacement for CryptoPunks specifically. Metadata (image/
 * name/traits) is only fetched for the current page's items via OpenSea's
 * per-NFT endpoint — reuses the same cached call the normal Seaport path
 * already makes, so cost per page is identical to any other OpenSea
 * collection, not a 10,000-item metadata fetch.
 */
export async function getCryptoPunksOnchainListings(limit: number, cursor?: string): Promise<OpenSeaPage> {
  const offers = await fetchPublicOffers();
  const offset = cursor ? Number(cursor) : 0;
  const page = offers.slice(offset, offset + limit);
  const listings = await Promise.all(
    page.map(async (offer) => {
      const nft = await getOpenSeaNftMetadata("ethereum", CRYPTOPUNKS_CONTRACT, String(offer.punkIndex));
      const raw: OnchainPunkListingRaw = {
        source: "cryptopunks-onchain",
        punkIndex: offer.punkIndex,
        seller: offer.seller,
        minValueWei: offer.minValueWei.toString(),
      };
      return {
        vendor: "opensea" as const,
        chainFamily: "evm" as const,
        collectionSlug: CRYPTOPUNKS_SLUG,
        tokenId: String(offer.punkIndex),
        name: nft?.name ?? `CryptoPunk #${offer.punkIndex}`,
        imageUrl: nft?.image_url,
        traits: nft?.traits?.map((t) => ({ traitType: t.trait_type, value: String(t.value) })),
        listed: true,
        price: formatEther(offer.minValueWei),
        priceCurrency: "ETH",
        seller: offer.seller,
        raw,
      };
    }),
  );
  const nextCursor = offset + limit < offers.length ? String(offset + limit) : undefined;
  return { listings, nextCursor };
}

/** Same shape as countOpenSeaListedItems — real count/floor, no pagination cost since fetchPublicOffers already scans everything. */
export async function getCryptoPunksOnchainListedCount(): Promise<OpenSeaListedCount> {
  const offers = await fetchPublicOffers();
  const cheapest = offers[0];
  return {
    count: offers.length,
    approximate: false,
    floorPrice: cheapest ? formatEther(cheapest.minValueWei) : undefined,
    floorPriceCurrency: cheapest ? "ETH" : undefined,
  };
}
