// Real, publicly-known official brand colors — not invented — used for the
// source→destination gradient accent between the sell/buy chain icons
// (2026-08-06 visual pass). Keyed the same way SwapPanel.tsx already
// identifies a token's chain: SelectedToken.chainId (a real EVM chain id, or
// the Solana chain id constant 792703809 also used in SwapPanel.tsx).
const SOLANA_CHAIN_ID = 792703809;

// Sui doesn't have a numeric EVM-style chain id in this app's swap flow (no
// Sui-origin/destination support in SwapPanel today — see AGENTS.md), so it's
// omitted here rather than guessing a placeholder id; add it if/when Sui
// swap support lands.
const CHAIN_COLORS: Record<number, string> = {
  [SOLANA_CHAIN_ID]: "#9945FF", // Solana purple (official brand color)
  1: "#627EEA", // Ethereum
  8453: "#0052FF", // Base
  137: "#8247E5", // Polygon
  42161: "#28A0F0", // Arbitrum
  10: "#FF0420", // Optimism
  43114: "#E84142", // Avalanche
};

const FALLBACK_COLOR = "#8B7FFF"; // matches --accent (dark theme) — neutral, not a fabricated brand color

export function chainBrandColor(chainId: number | undefined): string {
  if (chainId === undefined) return FALLBACK_COLOR;
  return CHAIN_COLORS[chainId] ?? FALLBACK_COLOR;
}
