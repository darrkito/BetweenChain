import { splitAmount } from "@/lib/baskets/split";

// Portfolio Rebalancer (2026-08-09) — pure delta/matching math, no wallet/
// RPC here (same "pure, testable" split as lib/baskets/split.ts). Real
// scope decision from PLAN_ROUTE_QUALITY_FEATURES.md: the pitch's "one
// atomic signature" claim isn't achievable (confirmed false for every
// similar batch-swap pitch this session) — v1 computes a real rebalance
// plan as a SEQUENCE of ordinary swaps (each its own signature, same
// pattern as Dust Sweeper/Evac Engine), not a relayer-batched single
// signature (a real, scoped follow-up, logged in the plan doc).
export interface RebalanceHolding {
  key: string; // `${chainId}:${address}` — matches holdingKey() conventions elsewhere in this app
  usdValue: number;
}

export interface RebalanceTarget {
  key: string;
  targetPct: number; // 0-100, should sum to ~100 across all targets
}

export interface SellLeg {
  key: string;
  excessUsd: number;
}

export interface BuyLeg {
  key: string;
  deficitUsd: number;
}

export interface RebalancePlan {
  sells: SellLeg[];
  buys: BuyLeg[];
  totalPortfolioUsd: number;
}

/**
 * Computes what's over- and under-allocated relative to target percentages.
 * A holding not present in `targets` is treated as target 0% (fully sold) —
 * matches the intuitive "anything I didn't set a target for gets rebalanced
 * away" behavior.
 */
export function computeRebalanceDeltas(holdings: RebalanceHolding[], targets: RebalanceTarget[]): RebalancePlan {
  const totalPortfolioUsd = holdings.reduce((sum, h) => sum + h.usdValue, 0);
  const targetByKey = new Map(targets.map((t) => [t.key, t.targetPct]));
  // Union of every key that appears in either holdings or targets — a
  // target for an asset not currently held is a pure buy (deficit = full
  // target amount), same as an untargeted holding is a pure sell.
  const allKeys = new Set([...holdings.map((h) => h.key), ...targets.map((t) => t.key)]);

  const sells: SellLeg[] = [];
  const buys: BuyLeg[] = [];
  for (const key of allKeys) {
    const currentUsd = holdings.find((h) => h.key === key)?.usdValue ?? 0;
    const targetUsd = totalPortfolioUsd * ((targetByKey.get(key) ?? 0) / 100);
    const delta = targetUsd - currentUsd;
    if (delta < -0.01) sells.push({ key, excessUsd: -delta });
    else if (delta > 0.01) buys.push({ key, deficitUsd: delta });
  }

  return { sells, buys, totalPortfolioUsd };
}

/**
 * For ONE sell leg's atomic sell amount, splits it across every buy leg
 * proportional to that buy's share of TOTAL deficit — combined across all
 * sells, each buy target ends up funded to its correct total deficit
 * amount. Reuses splitAmount's exact-sum-guaranteeing BigInt math.
 */
export function splitSellAcrossBuys(sellAtomicAmount: string, buys: BuyLeg[]): Array<{ key: string; atomicAmount: string }> {
  if (buys.length === 0) return [];
  const totalDeficit = buys.reduce((s, b) => s + b.deficitUsd, 0);
  if (totalDeficit <= 0) return [];
  const amounts = splitAmount(
    sellAtomicAmount,
    buys.map((b) => ({ percentage: (b.deficitUsd / totalDeficit) * 100 })),
  );
  return buys.map((b, i) => ({ key: b.key, atomicAmount: amounts[i] }));
}
