// Pure, testable dust-value filtering (2026-08-08) — same split as
// lib/client/dustAccounts.ts: the actual RPC/API fetching lives in the
// Dust Sweeper page component, this file only knows how to filter/sum
// already-fetched, already-USD-priced holdings. "Dust" here means a real,
// nonzero, priced balance under a threshold — a different concept from
// dustAccounts.ts's "genuinely zero-balance account" (rent reclaim); the
// Dust Sweeper page uses both.
export interface DustHolding {
  chainLabel: string;
  chainSlug: string;
  chainId: number | null; // null for Sui — no swap-chain id exists for it yet
  symbol: string;
  logoURI: string;
  address: string; // mint / contract address / "native"
  decimals: number;
  balance: string; // human units
  balanceUsd: number;
  isNative: boolean;
}

export interface DustThreshold {
  minUsd: number;
  maxUsd: number;
}

// minUsd excludes holdings with no known price (balanceUsd would be 0,
// indistinguishable from "genuinely worth nothing" — never swept either
// way, since there's nothing to safely quote a swap against).
export const DEFAULT_DUST_THRESHOLD: DustThreshold = { minUsd: 0.01, maxUsd: 50 };

export function filterDustHoldings(holdings: DustHolding[], threshold: DustThreshold = DEFAULT_DUST_THRESHOLD): DustHolding[] {
  return holdings.filter((h) => h.balanceUsd >= threshold.minUsd && h.balanceUsd <= threshold.maxUsd);
}

export function sumDustUsd(holdings: DustHolding[]): number {
  return holdings.reduce((sum, h) => sum + h.balanceUsd, 0);
}

// Never let the chosen consolidation target show up in its own "dust to
// sweep" list — sweeping SOL into SOL is a no-op that would just burn gas.
export function excludeTarget(holdings: DustHolding[], target: { chainId: number | null; address: string }): DustHolding[] {
  return holdings.filter((h) => !(h.chainId === target.chainId && h.address.toLowerCase() === target.address.toLowerCase()));
}
