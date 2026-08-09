import { describe, it, expect } from "vitest";
import { computeRebalanceDeltas, splitSellAcrossBuys } from "./computeDeltas";

describe("computeRebalanceDeltas", () => {
  it("finds one sell and one buy for a simple two-asset skew", () => {
    // $1000 total, currently 80% SOL / 20% USDC, target 50/50
    const plan = computeRebalanceDeltas(
      [
        { key: "sol", usdValue: 800 },
        { key: "usdc", usdValue: 200 },
      ],
      [
        { key: "sol", targetPct: 50 },
        { key: "usdc", targetPct: 50 },
      ],
    );
    expect(plan.totalPortfolioUsd).toBe(1000);
    expect(plan.sells).toEqual([{ key: "sol", excessUsd: 300 }]);
    expect(plan.buys).toEqual([{ key: "usdc", deficitUsd: 300 }]);
  });

  it("treats a holding with no target as a full sell", () => {
    const plan = computeRebalanceDeltas([{ key: "shitcoin", usdValue: 100 }], [{ key: "usdc", targetPct: 100 }]);
    expect(plan.sells).toEqual([{ key: "shitcoin", excessUsd: 100 }]);
    expect(plan.buys).toEqual([{ key: "usdc", deficitUsd: 100 }]);
  });

  it("treats a target with no current holding as a full buy", () => {
    const plan = computeRebalanceDeltas([{ key: "usdc", usdValue: 100 }], [{ key: "usdc", targetPct: 50 }, { key: "eth", targetPct: 50 }]);
    expect(plan.buys).toEqual([{ key: "eth", deficitUsd: 50 }]);
  });

  it("produces no legs when already at target", () => {
    const plan = computeRebalanceDeltas([{ key: "sol", usdValue: 500 }, { key: "usdc", usdValue: 500 }], [{ key: "sol", targetPct: 50 }, { key: "usdc", targetPct: 50 }]);
    expect(plan.sells).toEqual([]);
    expect(plan.buys).toEqual([]);
  });

  it("ignores sub-cent noise so it doesn't generate a dust leg", () => {
    const plan = computeRebalanceDeltas([{ key: "sol", usdValue: 500.001 }, { key: "usdc", usdValue: 499.999 }], [{ key: "sol", targetPct: 50 }, { key: "usdc", targetPct: 50 }]);
    expect(plan.sells).toEqual([]);
    expect(plan.buys).toEqual([]);
  });
});

describe("splitSellAcrossBuys", () => {
  it("splits one sell across two buys proportional to their deficit share", () => {
    const result = splitSellAcrossBuys("1000000000", [
      { key: "eth", deficitUsd: 300 },
      { key: "usdc", deficitUsd: 100 },
    ]);
    expect(result).toEqual([
      { key: "eth", atomicAmount: "750000000" },
      { key: "usdc", atomicAmount: "250000000" },
    ]);
  });

  it("gives the full amount to a single buy target", () => {
    const result = splitSellAcrossBuys("500", [{ key: "eth", deficitUsd: 42 }]);
    expect(result).toEqual([{ key: "eth", atomicAmount: "500" }]);
  });

  it("returns an empty array when there are no buy targets", () => {
    expect(splitSellAcrossBuys("500", [])).toEqual([]);
  });

  it("returns an empty array when total deficit is zero", () => {
    expect(splitSellAcrossBuys("500", [{ key: "eth", deficitUsd: 0 }])).toEqual([]);
  });

  it("sums to exactly the input amount across three uneven buys", () => {
    const total = "1000000007";
    const result = splitSellAcrossBuys(total, [
      { key: "a", deficitUsd: 33.33 },
      { key: "b", deficitUsd: 33.33 },
      { key: "c", deficitUsd: 33.34 },
    ]);
    const sum = result.reduce((s, r) => s + BigInt(r.atomicAmount), BigInt(0));
    expect(sum.toString()).toBe(total);
  });
});
