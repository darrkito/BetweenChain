import { EVM_CHAINS, type EvmChainOption } from "@/lib/nft/evmChains";

// Solana + EVM_CHAINS unified into one registry, same shape as
// EvmChainOption (2026-08-07, programmatic swap-pair landing pages).
// Deliberately does NOT include a native-token ticker field — Polygon's own
// native symbol has changed before, and static copy shouldn't risk going
// stale; the live QuotePreviewWidget/fetchNativeToken (which fetch real
// token data) are the only places an actual ticker symbol is shown.
// iconUrl reuses the same Relay-hosted per-chain icon CDN already used by
// EVM_CHAINS and lib/nft/labels.ts's Solana entry. Deliberately not
// "server-only" — used by both server (route metadata/sitemap) and client
// (QuotePreviewWidget, SwapPageClient) code.
export const SOLANA_SWAP_CHAIN: EvmChainOption = {
  slug: "solana",
  label: "Solana",
  chainId: 792703809,
  iconUrl: "https://assets.relay.link/icons/792703809/light.png",
};

export const SWAP_CHAINS: EvmChainOption[] = [SOLANA_SWAP_CHAIN, ...EVM_CHAINS];

// Bitcoin (2026-08-08b) — Relay's own real chain id, confirmed live via
// GET https://api.relay.link/chains (id: 8253038, vmType: "bvm",
// name: "bitcoin"). Reused here as a stable, non-arbitrary identifier even
// though this app does NOT execute BTC swaps through Relay (ChangeNOW is
// the execution engine — see app/api/quote/btc/route.ts) — Relay's /chains
// response is still what /api/tokens/chains and /api/tokens/list already
// source their chain/token metadata from (getRelayChains/getTokenListForChain
// in lib/chains/relayChains.ts / lib/chains/tokenList.ts), and Bitcoin's
// single real currency entry there (symbol "BTC", decimals 8) is exactly
// the token-list shape the picker needs — no separate hardcoded token
// metadata required. Deliberately NOT added to SWAP_CHAINS itself — that
// array feeds Relay-execution-assuming code (EVM RPC clients, Relay chain-id
// maps) that Bitcoin doesn't participate in.
export const BTC_CHAIN_ID = 8253038;

export function swapChainForSlug(slug: string): EvmChainOption | undefined {
  return SWAP_CHAINS.find((c) => c.slug === slug);
}

export function swapChainForChainId(chainId: number): EvmChainOption | undefined {
  return SWAP_CHAINS.find((c) => c.chainId === chainId);
}
