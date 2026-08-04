import "server-only";
import { browseMagicEdenCollections, getMagicEdenCollection } from "@/lib/nft/magiceden";
import { browseOpenSeaCollections, getOpenSeaCollection } from "@/lib/nft/opensea";
import { browseTradeportCollections, getTradeportCollection, isTradeportChain, TRADEPORT_CHAINS, type TradeportChain } from "@/lib/nft/tradeport";
import type { NftCollection, NftVendor } from "@/lib/nft/types";

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
  },
  opensea: {
    getCollection: (slug) => getOpenSeaCollection(slug),
    browseCollections: (chain, limit) => browseOpenSeaCollections(chain, limit),
  },
  tradeport: {
    getCollection: (slug, chain) => getTradeportCollection(resolveTradeportChain(chain), slug),
    browseCollections: (chain, limit) => browseTradeportCollections(resolveTradeportChain(chain), limit),
  },
};

export { TRADEPORT_CHAINS, isTradeportChain };
