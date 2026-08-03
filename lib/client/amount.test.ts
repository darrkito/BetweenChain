import { describe, it, expect } from "vitest";
import { toAtomicAmount, roundUpTo2Decimals } from "./amount";

describe("roundUpTo2Decimals", () => {
  it("always returns a string with exactly 2 decimal places, even for a whole number", () => {
    // Regression guard for the real 2026-07-22 bug: a round price like
    // exactly 9 SUI rendered as the bare number `9` in JSX (no decimal
    // point), inconsistent with every other price display.
    expect(roundUpTo2Decimals(9)).toBe("9.00");
  });

  it("rounds UP (ceiling), never down or to-nearest — a buyer must never see less than what's actually needed", () => {
    expect(roundUpTo2Decimals(9.881)).toBe("9.89");
    expect(roundUpTo2Decimals(9.001)).toBe("9.01");
    expect(roundUpTo2Decimals(9.8791)).toBe("9.88");
  });

  it("leaves an already-exact 2-decimal value unchanged", () => {
    expect(roundUpTo2Decimals(9.5)).toBe("9.50");
    expect(roundUpTo2Decimals(9.55)).toBe("9.55");
  });

  it("handles the Tradeport fee-safety-margin combination realistically (10% on a real listing price)", () => {
    // Same shape as the real display bug this app already hit: the same
    // collection showing two different floor numbers depending on which
    // page applied the margin. Not a full consistency check across call
    // sites (that needs the UI components themselves), but locks down the
    // core math those call sites all depend on.
    const TRADEPORT_FEE_SAFETY_MARGIN = 0.1;
    const rawListingPrice = 9;
    expect(roundUpTo2Decimals(rawListingPrice * (1 + TRADEPORT_FEE_SAFETY_MARGIN))).toBe("9.90");
  });

  it("handles zero", () => {
    expect(roundUpTo2Decimals(0)).toBe("0.00");
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
