import { describe, it, expect } from "vitest";
import { zeroAddress, parseEther } from "viem";
import { filterAndSortPublicOffers } from "./cryptopunksOnchain";

// Regression coverage for the exact live-verified filtering rule this
// module depends on: a private gift/escrow offer (non-zero onlySellTo,
// always minValue: 0 in practice) is not something any buyer can act on,
// and must never be shown as a free/buyable listing.
//
// BigInt literals (`0n`) aren't available at this project's ES2017 target —
// same reason lib/chains/evm.ts uses `BigInt(3)` instead of `3n` — so amounts
// here go through `parseEther` (also sidesteps writing out 18-zero wei
// literals by hand) or `BigInt(0)` for the zero case.
const SELLER_A = "0x000000000000000000000000000000000000A1";
const SELLER_B = "0x000000000000000000000000000000000000B2";
const SPECIFIC_BUYER = "0x000000000000000000000000000000000000CC";
const ZERO = BigInt(0);

function offer(punkIndex: number, seller: string, minValueWei: bigint, onlySellTo: string, isForSale = true) {
  return { status: "success" as const, result: [isForSale, BigInt(punkIndex), seller, minValueWei, onlySellTo] as const };
}

describe("filterAndSortPublicOffers", () => {
  it("includes a genuine public offer (onlySellTo is the zero address)", () => {
    const result = filterAndSortPublicOffers([offer(1, SELLER_A, parseEther("32.26"), zeroAddress)]);
    expect(result).toEqual([{ punkIndex: 1, seller: SELLER_A, minValueWei: parseEther("32.26") }]);
  });

  it("EXCLUDES a private gift/escrow offer (onlySellTo is a specific address) — this is the real bug this app avoided: these are not buyable by a random user and must not be shown as a listing", () => {
    const result = filterAndSortPublicOffers([offer(2, SELLER_A, ZERO, SPECIFIC_BUYER)]);
    expect(result).toEqual([]);
  });

  it("excludes an offer where isForSale is false, even if onlySellTo happens to be zero", () => {
    const result = filterAndSortPublicOffers([offer(3, SELLER_A, BigInt(1), zeroAddress, false)]);
    expect(result).toEqual([]);
  });

  it("excludes a failed multicall result instead of throwing or treating it as an offer", () => {
    const result = filterAndSortPublicOffers([{ status: "failure" }, offer(4, SELLER_A, parseEther("1"), zeroAddress)]);
    expect(result).toEqual([{ punkIndex: 4, seller: SELLER_A, minValueWei: parseEther("1") }]);
  });

  it("sorts ascending by price so the cheapest offer is first (the displayed floor)", () => {
    const result = filterAndSortPublicOffers([
      offer(10, SELLER_A, parseEther("50"), zeroAddress),
      offer(11, SELLER_B, parseEther("32.26"), zeroAddress), // cheapest — should end up first
      offer(12, SELLER_A, parseEther("40"), zeroAddress),
    ]);
    expect(result.map((o) => o.punkIndex)).toEqual([11, 12, 10]);
  });

  it("a realistic mixed batch: public offers survive and sort correctly, private gifts are dropped entirely", () => {
    const result = filterAndSortPublicOffers([
      offer(100, SELLER_A, parseEther("35"), zeroAddress), // public
      offer(101, SELLER_B, ZERO, SPECIFIC_BUYER), // private gift — excluded
      offer(102, SELLER_A, parseEther("32.26"), zeroAddress), // public, cheapest
      { status: "failure" as const }, // RPC failure for this index — excluded
      offer(103, SELLER_B, ZERO, zeroAddress, false), // never offered (default struct state) — excluded
    ]);
    expect(result).toEqual([
      { punkIndex: 102, seller: SELLER_A, minValueWei: parseEther("32.26") },
      { punkIndex: 100, seller: SELLER_A, minValueWei: parseEther("35") },
    ]);
  });

  it("returns an empty array for no results", () => {
    expect(filterAndSortPublicOffers([])).toEqual([]);
  });
});
