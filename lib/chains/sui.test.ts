import { describe, it, expect } from "vitest";
import { evaluateSuiBuyTx } from "./sui";

// Regression coverage for the 2026-08-04 fraud-bug fix (Sui/Tradeport side)
// — see lib/chains/evm.test.ts for the shared exploit writeup. Same
// balanceChanges/AddressOwner shape already proven live in
// dryRunSuiTransactionCostMist (see sui.ts).

const SUI_COIN_TYPE = "0x2::sui::SUI";
const BUYER = "0xbuyer00000000000000000000000000000000000000000000000000000001";
const OTHER = "0xother00000000000000000000000000000000000000000000000000000002";
const MIST_PRICE = BigInt(15_000_000_000); // 15 SUI

function validParams(overrides: Partial<Parameters<typeof evaluateSuiBuyTx>[0]> = {}) {
  return {
    effectsStatus: "success",
    sender: BUYER,
    balanceChanges: [{ coinType: SUI_COIN_TYPE, amount: "-15000000000", addressOwner: BUYER }],
    expectedSigner: BUYER,
    minMistSpent: MIST_PRICE,
    ...overrides,
  };
}

describe("evaluateSuiBuyTx", () => {
  it("accepts a tx where the buyer genuinely signed and spent at least the listing price", () => {
    expect(evaluateSuiBuyTx(validParams())).toBe(true);
  });

  it("accepts spending slightly more than the floor (gas on top)", () => {
    expect(evaluateSuiBuyTx(validParams({ balanceChanges: [{ coinType: SUI_COIN_TYPE, amount: "-15012345678", addressOwner: BUYER }] }))).toBe(true);
  });

  it("THE EXPLOIT: rejects an unrelated valid tx replayed against this purchase (different sender)", () => {
    expect(evaluateSuiBuyTx(validParams({ sender: OTHER }))).toBe(false);
  });

  it("rejects when there's no balance change for the buyer at all", () => {
    expect(evaluateSuiBuyTx(validParams({ balanceChanges: [] }))).toBe(false);
  });

  it("rejects a balance change in the wrong coin type (not SUI)", () => {
    expect(evaluateSuiBuyTx(validParams({ balanceChanges: [{ coinType: "0x2::usdc::USDC", amount: "-15000000000", addressOwner: BUYER }] }))).toBe(
      false,
    );
  });

  it("rejects a failed tx", () => {
    expect(evaluateSuiBuyTx(validParams({ effectsStatus: "failure" }))).toBe(false);
  });

  it("rejects spending less than the listing price (e.g. a trivial dust self-transfer)", () => {
    expect(evaluateSuiBuyTx(validParams({ balanceChanges: [{ coinType: SUI_COIN_TYPE, amount: "-1000", addressOwner: BUYER }] }))).toBe(false);
  });

  it("rejects when the buyer's balance actually increased (received funds, didn't pay)", () => {
    expect(evaluateSuiBuyTx(validParams({ balanceChanges: [{ coinType: SUI_COIN_TYPE, amount: "15000000000", addressOwner: BUYER }] }))).toBe(false);
  });
});
