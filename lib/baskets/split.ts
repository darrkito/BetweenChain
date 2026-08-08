// Pure, testable basket-split math (2026-08-08) — same split as
// lib/dust/detect.ts: no wallet/RPC/fetch here, just the arithmetic, so it
// can be unit tested without a real wallet or network connection.
export interface BasketAllocation {
  percentage: number; // 0-100, allocations across a basket should sum to ~100
}

/**
 * Splits a total atomic-unit amount across N allocations proportionally by
 * `percentage`. Integer (BigInt) math throughout — atomic amounts are
 * always whole numbers, and floating-point division here would risk a
 * sum that doesn't exactly equal the input (either stranding a few atomic
 * units unspent, or overspending past the real balance).
 *
 * The LAST allocation absorbs whatever rounding remainder is left after
 * every other leg is computed — guarantees the returned amounts always sum
 * to exactly `totalAtomic`, never more (never risks a swap sized larger
 * than the wallet's actual balance) and never less (never silently strands
 * a few atomic units unswept). Same "last item absorbs the remainder"
 * pattern as any real-money split calculation (e.g. splitting a bill).
 */
export function splitAmount(totalAtomic: string, allocations: BasketAllocation[]): string[] {
  if (allocations.length === 0) return [];
  const total = BigInt(totalAtomic);
  const amounts = allocations.map((a) => (total * BigInt(Math.round(a.percentage * 100))) / BigInt(10000));
  const sum = amounts.reduce((s, a) => s + a, BigInt(0));
  amounts[amounts.length - 1] += total - sum;
  return amounts.map((a) => a.toString());
}

/**
 * Re-normalizes a set of percentages to sum to exactly 100 — used when a
 * user drags one allocation's slider and the others need to proportionally
 * absorb the difference, keeping the total meaningful (a basket where the
 * sliders sum to 87% or 134% doesn't make sense to execute). Preserves the
 * RELATIVE weight between all allocations other than the one just changed;
 * if every other allocation is already 0 (only possible with a single
 * remaining allocation), the leftover is split evenly among them instead of
 * being silently dropped.
 */
export function normalizePercentages(percentages: number[]): number[] {
  const sum = percentages.reduce((s, p) => s + p, 0);
  if (sum === 0) {
    const even = 100 / percentages.length;
    return percentages.map(() => even);
  }
  return percentages.map((p) => (p / sum) * 100);
}
