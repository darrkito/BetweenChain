// ChangeNOW's own network slugs for each EVM chain where ETH is the NATIVE
// asset (ticker "eth", not a bridged/wrapped representation) — confirmed
// live 2026-08-18 via GET /v2/exchange/currencies (ticker=eth): eth
// (mainnet), bsc (bridged ETH on BNB Chain — deliberately excluded, BSC's
// actual native gas token is BNB, a completely different ChangeNOW
// currency this app doesn't support), arbitrum, op (Optimism), zksync,
// base, strk (Starknet — not an EVM chain this app has an RPC client for),
// lna (Linea), manta. Only the ones lib/chains/evm.ts already has an RPC
// client for are listed below.
//
// Shared between client (SwapPanel.tsx's Sell-token picker filter,
// SwapPageClient.tsx's swap execution) and server (the /api/quote/btc*
// routes, lib/chains/changenow.ts's fromNetwork param) — deliberately no
// "server-only" import here, unlike lib/chains/changenow.ts itself, so
// there is exactly one source of truth for chain-id -> network on both
// sides instead of two maps that could silently drift apart.
export const CHANGENOW_ETH_NETWORK_BY_CHAIN_ID: Record<number, string> = {
  1: "eth", // Ethereum mainnet
  8453: "base",
  42161: "arbitrum",
  10: "op", // Optimism
  324: "zksync", // zkSync Era
  59144: "lna", // Linea
  169: "manta", // Manta Pacific
};

/**
 * Resolves the ChangeNOW `fromNetwork` for an "eth" quote given the actual
 * chain the Sell token was picked from — used by both /api/quote/btc/
 * preview and /api/quote/btc so a chain id that isn't in the map above
 * (BSC, Polygon, an unsupported L2, a stale/spoofed value, ...) fails loud
 * with a clear message instead of silently defaulting to Ethereum mainnet,
 * which would quote one network while the actual deposit transaction signs
 * on another — a real-funds mismatch risk, not just a UX gap. Currencies
 * other than "eth" (btc/sol/sui) don't have a network distinction in this
 * app at all, so this always returns undefined for them (unchanged
 * pre-existing behavior: fromNetwork defaults to fromCurrency).
 */
export function resolveChangeNowFromNetwork(
  currency: "btc" | "sol" | "eth" | "sui",
  chainId: number | null,
): { network: string | undefined } | { error: string } {
  if (currency !== "eth" || chainId == null) return { network: undefined };
  const network = CHANGENOW_ETH_NETWORK_BY_CHAIN_ID[chainId];
  if (!network) return { error: "This network isn't supported for this pair yet." };
  return { network };
}
