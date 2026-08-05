import { describe, it, expect } from "vitest";
import { toAtomicAmount, roundUpTo3Decimals } from "./amount";

describe("roundUpTo3Decimals", () => {
  it("always returns a string with exactly 3 decimal places, even for a whole number", () => {
    // Regression guard for the real 2026-07-22 bug: a round price like
    // exactly 9 SUI rendered as the bare number `9` in JSX (no decimal
    // point), inconsistent with every other price display.
    expect(roundUpTo3Decimals(9)).toBe("9.000");
  });

  it("rounds UP (ceiling), never down or to-nearest — a buyer must never see less than what's actually needed", () => {
    expect(roundUpTo3Decimals(9.8811)).toBe("9.882");
    expect(roundUpTo3Decimals(9.0001)).toBe("9.001");
    expect(roundUpTo3Decimals(9.87901)).toBe("9.880");
  });

  it("leaves an already-exact 3-decimal value unchanged", () => {
    expect(roundUpTo3Decimals(9.5)).toBe("9.500");
    expect(roundUpTo3Decimals(9.55)).toBe("9.550");
    expect(roundUpTo3Decimals(9.551)).toBe("9.551");
  });

  it("handles the Tradeport fee-safety-margin combination realistically (10% on a real listing price)", () => {
    // Same shape as the real display bug this app already hit: the same
    // collection showing two different floor numbers depending on which
    // page applied the margin. Not a full consistency check across call
    // sites (that needs the UI components themselves), but locks down the
    // core math those call sites all depend on.
    const TRADEPORT_FEE_SAFETY_MARGIN = 0.1;
    const rawListingPrice = 9;
    expect(roundUpTo3Decimals(rawListingPrice * (1 + TRADEPORT_FEE_SAFETY_MARGIN))).toBe("9.900");
  });

  it("handles zero", () => {
    expect(roundUpTo3Decimals(0)).toBe("0.000");
  });
});

describe("toAtomicAmount", () => {
  it("converts a whole-number human amount to atomic units", () => {
    expect(toAtomicAmount("9", 9)).toBe("9000000000");
  });

  it("converts a fractional human amount, padding out to the full decimal count", () => {
    expect(toAtomicAmount("1.5", 9)).toBe("1500000000");
  });

  it("truncates (does not round) fractional digits beyond the token's decimals", () => {
    expect(toAtomicAmount("1.123456789999", 9)).toBe("1123456789");
  });

  it("handles an amount with no whole part", () => {
    expect(toAtomicAmount(".5", 9)).toBe("500000000");
  });

  it("strips leading zeros from the whole part", () => {
    expect(toAtomicAmount("00009", 6)).toBe("9000000");
  });

  it("handles surrounding whitespace", () => {
    expect(toAtomicAmount("  9  ", 9)).toBe("9000000000");
  });

  it("returns \"0\" for a bare zero", () => {
    expect(toAtomicAmount("0", 9)).toBe("0");
  });
});
