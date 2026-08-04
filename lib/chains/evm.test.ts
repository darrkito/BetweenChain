import { describe, it, expect } from "vitest";
import { evaluateEvmBuyTx } from "./evm";

// Regression coverage for the 2026-08-04 fraud-bug fix: confirm-buy used to
// accept ANY successful tx, letting an attacker replay one unrelated valid
// tx hash across unlimited purchase rows. This is the actual decision logic
// that closes it — see the SECURITY FIX doc comment on verifyEvmBuyTx in
// ./evm.ts for the full exploit writeup.

const BUYER = "0x1111111111111111111111111111111111aaaa";
const SEAPORT = "0x2222222222222222222222222222222222bbbb";
const OTHER_CONTRACT = "0x3333333333333333333333333333333333cccc";
const PRICE_WEI = "1000000000000000000"; // 1 ETH

function validParams(overrides: Partial<Parameters<typeof evaluateEvmBuyTx>[0]> = {}) {
  return {
    receiptStatus: "success" as const,
    txFrom: BUYER,
    txTo: SEAPORT,
    txValue: BigInt(PRICE_WEI),
    expectedFrom: BUYER,
    expectedTo: SEAPORT,
    expectedValueWei: PRICE_WEI,
    ...overrides,
  };
}

describe("evaluateEvmBuyTx", () => {
  it("accepts a tx that genuinely matches from/to/value", () => {
    expect(evaluateEvmBuyTx(validParams())).toBe(true);
  });

  it("is case-insensitive on addresses (checksummed vs lowercase)", () => {
    expect(evaluateEvmBuyTx(validParams({ txFrom: BUYER.toUpperCase() as `0x${string}`, txTo: SEAPORT.toUpperCase() }))).toBe(true);
  });

  it("THE EXPLOIT: rejects an unrelated valid tx replayed against this purchase (wrong to/value)", () => {
    expect(evaluateEvmBuyTx(validParams({ txTo: OTHER_CONTRACT, txValue: BigInt(1) }))).toBe(false);
  });

  it("rejects a tx sent by someone other than the buyer", () => {
    expect(evaluateEvmBuyTx(validParams({ txFrom: "0x4444444444444444444444444444444444dddd" }))).toBe(false);
  });

  it("rejects a tx to the wrong contract", () => {
    expect(evaluateEvmBuyTx(validParams({ txTo: OTHER_CONTRACT }))).toBe(false);
  });

  it("rejects a tx carrying the wrong value (e.g. a trivial 0-value self-transfer)", () => {
    expect(evaluateEvmBuyTx(validParams({ txValue: BigInt(0) }))).toBe(false);
  });

  it("rejects a contract-creation tx (to is null)", () => {
    expect(evaluateEvmBuyTx(validParams({ txTo: null }))).toBe(false);
  });

  it("rejects a reverted tx even if from/to/value otherwise match", () => {
    expect(evaluateEvmBuyTx(validParams({ receiptStatus: "reverted" }))).toBe(false);
  });
});
