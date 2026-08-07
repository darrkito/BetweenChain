import { describe, it, expect } from "vitest";
import { filterZeroBalanceAccounts, sumReclaimableLamports, batchAccounts, type TokenAccountInfo } from "./dustAccounts";

const account = (overrides: Partial<TokenAccountInfo>): TokenAccountInfo => ({
  pubkey: "acct",
  mint: "mint",
  amount: "0",
  lamports: 2039280,
  ...overrides,
});

describe("filterZeroBalanceAccounts", () => {
  it("keeps only genuinely zero-balance accounts", () => {
    const accounts = [account({ pubkey: "a", amount: "0" }), account({ pubkey: "b", amount: "1000" }), account({ pubkey: "c", amount: "0" })];
    const result = filterZeroBalanceAccounts(accounts);
    expect(result.map((a) => a.pubkey)).toEqual(["a", "c"]);
  });

  it("never treats a malformed amount as safe to close", () => {
    const accounts = [account({ pubkey: "bad", amount: "not-a-number" })];
    expect(filterZeroBalanceAccounts(accounts)).toEqual([]);
  });

  it("returns an empty array when nothing is zero-balance", () => {
    expect(filterZeroBalanceAccounts([account({ amount: "5" })])).toEqual([]);
  });
});

describe("sumReclaimableLamports", () => {
  it("sums each account's real lamports, not a hardcoded constant", () => {
    const accounts = [account({ lamports: 2039280 }), account({ lamports: 2100000 })];
    expect(sumReclaimableLamports(accounts)).toBe(4139280);
  });

  it("returns 0 for an empty list", () => {
    expect(sumReclaimableLamports([])).toBe(0);
  });
});

describe("batchAccounts", () => {
  it("splits into batches of the given size", () => {
    const items = Array.from({ length: 32 }, (_, i) => i);
    const batches = batchAccounts(items, 15);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(15);
    expect(batches[1]).toHaveLength(15);
    expect(batches[2]).toHaveLength(2);
  });

  it("returns a single empty-array-free batch list for an empty input", () => {
    expect(batchAccounts([])).toEqual([]);
  });
});
