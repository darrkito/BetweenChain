import { EVM_CHAINS, type EvmChainOption } from "@/lib/nft/evmChains";
import { SWAP_ONLY_EVM_CHAINS } from "@/lib/chains/swapOnlyEvmChains";
import { SUI_ICON_URL } from "@/lib/nft/labels";
import type { ChainInfo } from "@/lib/chains/types";

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

// SWAP_ONLY_EVM_CHAINS (2026-08-18) — 39 additional Relay-supported EVM
// chains, kept out of EVM_CHAINS itself so they don't also become NFT
// browse tabs (see that file's own doc comment for why).
export const SWAP_CHAINS: EvmChainOption[] = [SOLANA_SWAP_CHAIN, ...EVM_CHAINS, ...SWAP_ONLY_EVM_CHAINS];

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

// Same Relay-hosted icon CDN as every EVM_CHAINS/SOLANA_SWAP_CHAIN entry,
// confirmed live via GET /api/tokens/list?chainId=8253038's own
// logoURI — reused here rather than a second hardcoded copy.
export const BTC_ICON_URL = "https://assets.relay.link/icons/currencies/btc.png";

// Sui (2026-08-18) — unlike Solana/BTC above, Sui has no real Relay-
// assigned chain id to reuse (Relay's live /chains response has no Sui
// entry at all; ChangeNOW is the execution engine here too, same as BTC —
// see app/api/quote/btc/route.ts). This is a genuinely synthetic sentinel,
// not an external standard's id — chosen only to be far outside any real
// EVM chain id range (which top out in the low billions today) and outside
// the existing BTC_CHAIN_ID/Solana-pseudo-id ranges, to rule out collision.
// Also deliberately NOT added to SWAP_CHAINS (same reasoning as BTC_CHAIN_ID
// above) — its chain metadata is hand-built in
// app/api/tokens/chains/route.ts and lib/chains/tokenList.ts instead of
// sourced from Relay, since Relay has nothing to source it from.
export const SUI_CHAIN_ID = 100000000001;

// Hand-built ChainInfo for Sui (2026-08-18) — same shape Relay's real
// entries have, so the token-select modal's picker (which only ever reads
// this shape, never branches on "is this Relay data") treats it
// identically. Reused by both app/api/tokens/chains/route.ts (chain
// sidebar) and lib/chains/tokenList.ts (native-SUI-only token list) so
// there's exactly one place this gets edited if Sui's icon/decimals ever
// need to change. decimals: 9 and the zero address for the native
// currency match Sui's real on-chain conventions (SUI's own coin type is
// 0x2::sui::SUI, MIST has 9 decimals) — not invented.
export const SUI_CHAIN_INFO: ChainInfo = {
  id: SUI_CHAIN_ID,
  name: "sui",
  displayName: "Sui",
  iconUrl: SUI_ICON_URL,
  vmType: "sui-move",
  nativeCurrency: { symbol: "SUI", address: "0x2::sui::SUI", decimals: 9 },
  featuredTokens: [{ id: "sui", symbol: "SUI", name: "Sui", address: "0x2::sui::SUI", decimals: 9, logoURI: SUI_ICON_URL }],
};

export function swapChainForSlug(slug: string): EvmChainOption | undefined {
  return SWAP_CHAINS.find((c) => c.slug === slug);
}

export function swapChainForChainId(chainId: number): EvmChainOption | undefined {
  return SWAP_CHAINS.find((c) => c.chainId === chainId);
}

// "btc"/"sol"/"eth"/"sui" ChangeNOW-currency-ticker for a token on one of
// the currencies the BTC/Sui (ChangeNOW) swap flow handles. 2026-08-18:
// extracted here as the single source of truth — this exact function used
// to be duplicated twice (SwapPanel.tsx's btcPairCurrency,
// SwapPageClient.tsx's btcFlowCurrency), and a third near-copy would have
// been needed for QuotePreviewWidget.tsx and the new BTC/Sui swap-pair
// landing pages. Only ever meaningful when the caller has already confirmed
// the pair involves BTC or Sui — see SwapPanel.tsx's isBuyTokenAllowed/
// isSellTokenAllowedForBtcPair for that gate.
export function btcFlowCurrency(t: { chainId: number }): "btc" | "sui" | "sol" | "eth" {
  if (t.chainId === BTC_CHAIN_ID) return "btc";
  if (t.chainId === SUI_CHAIN_ID) return "sui";
  return t.chainId === SOLANA_SWAP_CHAIN.chainId ? "sol" : "eth";
}

// chain id -> slug for BTC/Sui, kept OUT of SWAP_CHAINS itself (see
// BTC_CHAIN_ID/SUI_CHAIN_ID's own docs — that array feeds Relay-execution-
// assuming code neither chain participates in). Used only for the
// ?sell=&buy= prefill link shape (QuotePreviewWidget.tsx's swapHref) and
// BTC/Sui swap-pair page slugs (lib/content/swapPairs.ts) — a purely
// cosmetic URL concern, not an execution-path one.
const BTC_SUI_SLUG_BY_CHAIN_ID: Record<number, string> = {
  [BTC_CHAIN_ID]: "bitcoin",
  [SUI_CHAIN_ID]: "sui",
};

export function slugForSwapChainId(chainId: number): string | undefined {
  return swapChainForChainId(chainId)?.slug ?? BTC_SUI_SLUG_BY_CHAIN_ID[chainId];
}

/** Same BTC/Sui-inclusive coverage as slugForSwapChainId, for display labels instead of URL slugs. */
export function labelForSwapChainId(chainId: number): string {
  if (chainId === BTC_CHAIN_ID) return "Bitcoin";
  if (chainId === SUI_CHAIN_ID) return "Sui";
  return swapChainForChainId(chainId)?.label ?? "";
}

/** Reverse of the above — slug -> {chainId, label}, for ?sell=&buy= prefill parsing (SwapPageClient.tsx). */
export function resolveSwapChainSlug(slug: string): { chainId: number; label: string } | undefined {
  const chain = swapChainForSlug(slug);
  if (chain) return { chainId: chain.chainId, label: chain.label };
  if (slug === "bitcoin") return { chainId: BTC_CHAIN_ID, label: "Bitcoin" };
  if (slug === "sui") return { chainId: SUI_CHAIN_ID, label: "Sui" };
  return undefined;
}
