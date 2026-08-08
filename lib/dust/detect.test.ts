import { describe, it, expect } from "vitest";
import { filterDustHoldings, sumDustUsd, excludeTarget, DEFAULT_DUST_THRESHOLD, type DustHolding } from "./detect";

const holding = (overrides: Partial<DustHolding>): DustHolding => ({
  chainLabel: "Solana",
  chainSlug: "solana",
  chainId: 792703809,
  symbol: "TOK",
  logoURI: "",
  address: "mint",
  decimals: 9,
  balance: "1",
  balanceUsd: 5,
  isNative: false,
  ...overrides,
});

describe("filterDustHoldings", () => {
  it("keeps only holdings within [minUsd, maxUsd]", () => {
    const holdings = [holding({ address: "a", balanceUsd: 0 }), holding({ address: "b", balanceUsd: 12 }), holding({ address: "c", balanceUsd: 500 })];
    const result = filterDustHoldings(holdings, DEFAULT_DUST_THRESHOLD);
    expect(result.map((h) => h.address)).toEqual(["b"]);
  });

  it("excludes unpriced (balanceUsd 0) holdings by default", () => {
    expect(filterDustHoldings([holding({ balanceUsd: 0 })])).toEqual([]);
  });

  it("respects a custom threshold", () => {
    const holdings = [holding({ address: "a", balanceUsd: 2 }), holding({ address: "b", balanceUsd: 8 })];
    const result = filterDustHoldings(holdings, { minUsd: 1, maxUsd: 5 });
    expect(result.map((h) => h.address)).toEqual(["a"]);
  });
});

describe("sumDustUsd", () => {
  it("sums balanceUsd across holdings", () => {
    expect(sumDustUsd([holding({ balanceUsd: 1.5 }), holding({ balanceUsd: 2.25 })])).toBeCloseTo(3.75);
  });

  it("returns 0 for an empty list", () => {
    expect(sumDustUsd([])).toBe(0);
  });
});

describe("excludeTarget", () => {
  it("removes a holding matching the target chain+address", () => {
    const holdings = [holding({ chainId: 792703809, address: "SOL_MINT" }), holding({ chainId: 8453, address: "0xabc" })];
    const result = excludeTarget(holdings, { chainId: 792703809, address: "SOL_MINT" });
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe(8453);
  });

  it("is case-insensitive on address", () => {
    const holdings = [holding({ chainId: 8453, address: "0xABC" })];
    expect(excludeTarget(holdings, { chainId: 8453, address: "0xabc" })).toEqual([]);
  });

  it("does not remove a holding with the same address on a different chain", () => {
    const holdings = [holding({ chainId: 8453, address: "0xabc" })];
    expect(excludeTarget(holdings, { chainId: 42161, address: "0xabc" })).toHaveLength(1);
  });
});
