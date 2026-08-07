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

export function swapChainForSlug(slug: string): EvmChainOption | undefined {
  return SWAP_CHAINS.find((c) => c.slug === slug);
}

export function swapChainForChainId(chainId: number): EvmChainOption | undefined {
  return SWAP_CHAINS.find((c) => c.chainId === chainId);
}
