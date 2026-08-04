import { describe, it, expect } from "vitest";
import { evaluateSolanaBuyTx } from "./solana";

// Regression coverage for the 2026-08-04 fraud-bug fix (Solana/Magic Eden
// side) — see evaluateEvmBuyTx's test file for the shared exploit writeup.
// Solana has no fixed "to" contract to check the way Seaport does, so this
// verifies the same intent (the buyer really paid the real price) via
// signer identity + balance-delta instead.

const BUYER = "BuyerPubkey11111111111111111111111111111";
const OTHER = "OtherPubkey11111111111111111111111111111";
const LAMPORTS_PRICE = BigInt(1_000_000_000); // 1 SOL

function validParams(overrides: Partial<Parameters<typeof evaluateSolanaBuyTx>[0]> = {}) {
  return {
    txErr: null,
    accountKeys: [
      { pubkey: BUYER, signer: true },
      { pubkey: "SomeProgram1111111111111111111111111111", signer: false },
    ],
    preBalances: [2_000_000_000, 0],
    postBalances: [1_000_000_000, 0], // buyer spent exactly 1 SOL
    expectedSigner: BUYER,
    minLamportsSpent: LAMPORTS_PRICE,
    ...overrides,
  };
}

describe("evaluateSolanaBuyTx", () => {
  it("accepts a tx where the buyer genuinely signed and spent at least the listing price", () => {
    expect(evaluateSolanaBuyTx(validParams())).toBe(true);
  });

  it("accepts spending slightly more than the floor (fees on top)", () => {
    expect(evaluateSolanaBuyTx(validParams({ postBalances: [999_995_000, 0] }))).toBe(true);
  });

  it("THE EXPLOIT: rejects an unrelated valid tx replayed against this purchase (buyer wasn't even a signer)", () => {
    expect(
      evaluateSolanaBuyTx(
        validParams({
          accountKeys: [{ pubkey: OTHER, signer: true }],
          preBalances: [2_000_000_000],
          postBalances: [1_000_000_000],
        }),
      ),
    ).toBe(false);
  });

  it("rejects when the buyer is present but only as a non-signer account", () => {
    expect(evaluateSolanaBuyTx(validParams({ accountKeys: [{ pubkey: BUYER, signer: false }] }))).toBe(false);
  });

  it("rejects a tx that failed on-chain", () => {
    expect(evaluateSolanaBuyTx(validParams({ txErr: { InstructionError: [0, "Custom"] } }))).toBe(false);
  });

  it("rejects a tx that spent less than the listing price (e.g. a trivial dust self-transfer)", () => {
    expect(evaluateSolanaBuyTx(validParams({ preBalances: [2_000_000_000, 0], postBalances: [1_999_999_000, 0] }))).toBe(false);
  });

  it("rejects when the buyer's balance actually increased (received funds, didn't pay)", () => {
    expect(evaluateSolanaBuyTx(validParams({ preBalances: [1_000_000_000, 0], postBalances: [2_000_000_000, 0] }))).toBe(false);
  });
});
