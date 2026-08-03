// No single vendor spans every NFT-trading chain family (confirmed via research,
// see PLAN.md's "Multichain NFT section" — Magic Eden went Solana-only in 2026-03,
// OpenSea doesn't do Solana NFTs, Tradeport is Move-only). Every NFT type here is
// vendor-tagged so callers always know which client built it and which raw shape
// must be replayed back into that vendor's buy-execution endpoint.

export type NftVendor = "magiceden" | "opensea" | "tradeport";

// The chain family determines which vendor(s) can serve a given collection, and
// which wallet type ultimately signs the buy transaction. Distinct from Relay's
// `vmType` (lib/chains/types.ts's ChainInfo) — "move" collections (Sui/Aptos) have
// no Relay-side funding route today, unlike solana/evm which Relay already bridges.
export type NftChainFamily = "solana" | "evm" | "move";

export interface NftCollection {
  vendor: NftVendor;
  chainFamily: NftChainFamily;
  // EVM chain id (matches Relay's chain ids) when chainFamily === "evm"; undefined
  // for solana/move, which aren't chain-id-addressed the same way.
  chainId?: number;
  // Vendor-specific collection identifier: Magic Eden's `symbol`, OpenSea's
  // `collection` slug, Tradeport's collection id. Opaque outside its own vendor.
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  bannerImageUrl?: string;
  floorPrice?: string; // formatted, in the collection's native chain currency
  floorPriceCurrency?: string;
  listedCount?: number;
  // Below: confirmed-available per vendor as of 2026-07-20, NOT symmetric —
  // Magic Eden's public API gives listedCount but no totalSupply; OpenSea
  // gives totalSupply but no cheap listedCount (its listings endpoint has no
  // total-count field, only a page + cursor). Never fabricate a missing
  // field — leave it undefined and let the UI render "—" rather than guess.
  totalSupply?: number;
  volume24hr?: string; // formatted; OpenSea only (stats `intervals[one_day]`)
  volume24hrCurrency?: string;
  numOwners?: number; // OpenSea only (stats `total.num_owners`)
  // Tradeport only, computed (not returned directly by any field): derived from
  // collection_floors(period: days_1) vs the current floor — see
  // lib/nft/tradeport.ts's enrichCollection for the exact math and the caveat
  // on ordering assumptions. Still no vendor exposes this as a native field.
  floorChange24hrPct?: number;
}

export interface NftTrait {
  traitType: string;
  value: string;
}

export interface NftListing {
  vendor: NftVendor;
  chainFamily: NftChainFamily;
  chainId?: number;
  collectionSlug: string;
  tokenId: string; // Solana mint address / EVM tokenId / Move object id
  name?: string;
  imageUrl?: string;
  traits?: NftTrait[];
  // Whether this specific item has a confirmed active listing right now.
  // Magic Eden's listings endpoint only ever returns listed items (always
  // true there). OpenSea's "all assets" endpoint (lib/nft/opensea.ts's
  // getOpenSeaAllAssets) returns full collection inventory regardless of
  // listing status — an item there is only marked listed:true if it also
  // appears in a separately-fetched listings page; unlisted/unknown items
  // are listed:false with no price, not guessed.
  listed: boolean;
  price?: string; // formatted amount, present only when listed
  priceCurrency?: string;
  seller?: string;
  // Raw vendor listing payload — MUST be replayed verbatim into that vendor's
  // buy-execution call, never reconstructed from these display fields (same
  // "replay the quote, don't rebuild it" rule already enforced for Jupiter/Relay
  // quotes elsewhere in this codebase — see lib/chains/relay.ts). Undefined
  // for unlisted assets, which have no buyable order to replay.
  raw?: unknown;
}
