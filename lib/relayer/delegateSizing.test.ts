import { describe, expect, it } from "vitest";
import { sizeLimitDelegateAmount, sizeDcaDelegateAmount } from "./delegateSizing";

describe("sizeLimitDelegateAmount", () => {
  it("applies a 10% buffer above takingAmount", () => {
    expect(sizeLimitDelegateAmount("1000000")).toBe(BigInt(1100000));
  });

  it("rounds up rather than truncating fractional atomic units", () => {
    expect(sizeLimitDelegateAmount("3")).toBe(BigInt(Math.ceil(3 * 1.1))); // 4
  });

  it("handles zero without throwing", () => {
    expect(sizeLimitDelegateAmount("0")).toBe(BigInt(0));
  });
});

describe("sizeDcaDelegateAmount", () => {
  it("applies a 25% buffer above the estimated output", () => {
    expect(sizeDcaDelegateAmount("1000000")).toBe(BigInt(1250000));
  });

  it("always delegates strictly more than the raw estimate for a positive amount", () => {
    const estimate = "987654321";
    expect(sizeDcaDelegateAmount(estimate)).toBeGreaterThan(BigInt(estimate));
  });
});
