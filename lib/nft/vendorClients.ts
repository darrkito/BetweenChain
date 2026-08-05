import "server-only";
import { browseMagicEdenCollections, getMagicEdenCollection, searchMagicEdenCollections } from "@/lib/nft/magiceden";
import { browseOpenSeaCollections, getOpenSeaCollection, searchOpenSeaCollections } from "@/lib/nft/opensea";
import {
  browseTradeportCollections,
  getTradeportCollection,
  searchTradeportCollections,
  isTradeportChain,
  TRADEPORT_CHAINS,
  type TradeportChain,
} from "@/lib/nft/tradeport";
import type { NftChainFamily, NftCollection, NftVendor } from "@/lib/nft/types";

/**
 * 2026-08-04 (architecture pass) — lib/nft/{magiceden,opensea,tradeport}.ts
 * each export their own collection-fetching functions with genuinely
 * different native signatures (Magic Eden: Solana-only, no chain param at
 * all; OpenSea: chain defaults to "ethereum"; Tradeport: chain is
 * *required*, no default, and its getCollection takes chain BEFORE slug
 * unlike the other two). That's a real difference in what each vendor
 * needs, not something worth papering over by changing their native
 * signatures (which are also used directly by the NFT purchase flow's
 * quote/execute/confirm routes with those exact shapes) — but the 3
 * detail-page-style routes (app/api/nft/{collection,collections}/route.ts)
 * were each hand-rolling their own nested vendor if/else dispatch with the
 * same shape, duplicated 3x.
 *
 * This adapts each vendor's real function to one uniform signature —
 * `(slug, chain?)` / `(chain?, limit?)` — purely at the call boundary, so
 * those routes can use a single typed lookup table instead of a nested
 * ternary. Doesn't touch the vendor modules' own native exports or any
 * other caller of them (buy/quote/execute flows keep using the native
 * signatures directly, unaffected).
 */
export interface NftVendorClient {
  getCollection(slug: string, chain?: string): Promise<NftCollection | undefined>;
  browseCollections(chain?: string, limit?: number): Promise<NftCollection[]>;
  // 2026-08-05 — see each vendor module's search function doc comment for
  // real capability differences: OpenSea/Tradeport are true universal
  // name search; Magic Eden is a documented best-effort (no real search API
  // exists for its Solana collections, see searchMagicEdenCollections).
  searchCollections(query: string, chain?: string, limit?: number): Promise<NftCollection[]>;
}

const DEFAULT_TRADEPORT_CHAIN: TradeportChain = "sui";

function resolveTradeportChain(chain?: string): TradeportChain {
  if (chain && isTradeportChain(chain)) return chain;
  return DEFAULT_TRADEPORT_CHAIN;
}

export const NFT_VENDOR_CLIENTS: Record<NftVendor, NftVendorClient> = {
  magiceden: {
    getCollection: (slug) => getMagicEdenCollection(slug),
    browseCollections: (_chain, limit) => browseMagicEdenCollections(limit),
    searchCollections: (query, _chain, limit) => searchMagicEdenCollections(query, limit),
  },
  opensea: {
    getCollection: (slug) => getOpenSeaCollection(slug),
    browseCollections: (chain, limit) => browseOpenSeaCollections(chain, limit),
    searchCollections: (query, chain, limit) => searchOpenSeaCollections(query, chain, limit),
  },
  tradeport: {
    getCollection: (slug, chain) => getTradeportCollection(resolveTradeportChain(chain), slug),
    browseCollections: (chain, limit) => browseTradeportCollections(resolveTradeportChain(chain), limit),
    searchCollections: (query, chain, limit) => searchTradeportCollections(resolveTradeportChain(chain), query, limit),
  },
};

// No single vendor spans more than one chain family (see PLAN.md's
// "Multichain NFT section") — this is the family -> vendor direction,
// complementing lib/nft/labels.ts's nftFamilyForVendor (vendor -> family).
// Shared (2026-08-04) between app/api/nft/collections/route.ts and
// app/nft/page.tsx's server-side browse fetch — was previously duplicated
// in the route file alone.
export const VENDOR_FOR_FAMILY: Record<NftChainFamily, NftVendor> = {
  solana: "magiceden",
  evm: "opensea",
  move: "tradeport",
};

export { TRADEPORT_CHAINS, isTradeportChain };
