// Which EVM chains this app's NFT browse/buy flow supports, beyond the
// original Ethereum-only build. Deliberately NOT "server-only" — both the
// browse-page chain picker (client) and lib/chains/relay.ts's OpenSea-slug
// -> Relay-chain-id map (server) need the same list, and it's static
// public data (no secrets), so one shared source avoids the two drifting
// out of sync the way a duplicated hardcoded map would.
//
// `slug` is OpenSea's own chain slug (confirmed against their docs/API,
// same as every other OpenSea chain param in this app — see
// lib/nft/opensea.ts). `chainId` is the real EVM chain id, which also
// happens to be what Relay uses as its chain id for EVM chains (Relay's
// chain ids match native EVM chain ids 1:1 — only Solana gets a made-up
// non-EVM id, see lib/chains/relay.ts's SOLANA_CHAIN_ID comment).
export interface EvmChainOption {
  slug: string;
  label: string;
  chainId: number;
  iconUrl: string;
}

// Base added 2026-07-21 (first new chain beyond the original Ethereum-only
// build) — chosen to go first since it has no OpenSea rate-limit history in
// this app yet, per explicit user request. Extend this list to add more
// (Polygon, Arbitrum, etc.) — no other code should need to change beyond
// this array, since every consumer (browse picker, Relay chain-id map, buy
// flow's ensureChain/sendStepAndWait target) reads from here.
//
// Polygon/Arbitrum/Optimism/Avalanche added 2026-08-03 — each slug verified
// live against OpenSea's `/v2/collections?chain=...` (garbage slugs 400 with
// "Unrecognized chain", these all 200'd with real collections whose own
// `contracts[].chain` field echoed the same slug back, confirming it's
// OpenSea's current canonical name, not a guess). Note: OpenSea also
// accepts "matic" as a legacy alias for Polygon, but "polygon" is the name
// their own data uses now, so that's what's used here. Every corresponding
// `lib/chains/evm.ts` RPC client + icon URL was also verified live before
// this list was extended (see that file's CHAIN_CONFIG comment). PLAN.md's
// full OpenSea chain table lists ~20 more (ApeChain, Berachain, Blast,
// Abstract, Sei, Monad, HyperEVM, Zora, Ronin, Flow, Unichain, Soneium,
// Shape, Ink, B3, GUNZ, Somnia, MegaETH, AnimeChain, Robinhood Chain) —
// deliberately NOT added here yet: each one's exact OpenSea slug needs the
// same live-verification treatment (some chains' "obvious" slug guess has
// already been wrong once, see the "matic" note above) rather than being
// assumed from the chain's common name.
export const EVM_CHAINS: EvmChainOption[] = [
  { slug: "ethereum", label: "Ethereum", chainId: 1, iconUrl: "https://assets.relay.link/icons/1/light.png" },
  { slug: "base", label: "Base", chainId: 8453, iconUrl: "https://assets.relay.link/icons/8453/light.png" },
  { slug: "polygon", label: "Polygon", chainId: 137, iconUrl: "https://assets.relay.link/icons/137/light.png" },
  { slug: "arbitrum", label: "Arbitrum", chainId: 42161, iconUrl: "https://assets.relay.link/icons/42161/light.png" },
  { slug: "optimism", label: "Optimism", chainId: 10, iconUrl: "https://assets.relay.link/icons/10/light.png" },
  { slug: "avalanche", label: "Avalanche", chainId: 43114, iconUrl: "https://assets.relay.link/icons/43114/light.png" },
  // Robinhood Chain added 2026-08-08 (real user request) — verified live
  // before adding: Relay's own /chains lists it (id 4663, vmType "evm",
  // depositEnabled true, disabled false), OpenSea's
  // `/v2/collections?chain=robinhood` returns real collections (confirming
  // "robinhood" is OpenSea's actual chain slug, not a guess), and viem
  // ships a built-in `robinhood` chain definition (viem/chains) with the
  // same chain id — no custom `defineChain` needed, see lib/chains/evm.ts.
  { slug: "robinhood", label: "Robinhood Chain", chainId: 4663, iconUrl: "https://assets.relay.link/icons/4663/light.png" },
];

export function evmChainForSlug(slug: string): EvmChainOption | undefined {
  return EVM_CHAINS.find((c) => c.slug === slug);
}
