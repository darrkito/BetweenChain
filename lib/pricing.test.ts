import { describe, it, expect, afterEach, vi } from "vitest";
import { getSolUsdPrice, getEthUsdPrice, getSuiUsdPrice, getBtcUsdPrice, lamportsToUsd, weiToUsd, mistToUsd, formatAtomicAmount } from "./pricing";

// This file directly guards the exact class of bug that has ALREADY happened
// in production once (Jupiter silently retired price/v2 for price/v3, a
// different response shape, which silently broke points crediting until
// caught live — see lib/pricing.ts's getSolUsdPrice comment and STATE.md
// 2026-07-18b). Every price fetcher must throw loudly on a malformed/
// unexpected response shape, never silently compute 0/NaN.

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("getSolUsdPrice", () => {
  const SOL_MINT = "So11111111111111111111111111111111111111112";

  it("parses a real price/v3-shaped response", async () => {
    mockFetchOnce(200, { [SOL_MINT]: { usdPrice: 150.25 } });
    await expect(getSolUsdPrice()).resolves.toBe(150.25);
  });

  it("throws on the old price/v2 response shape (regression guard for the real 2026-07-18b incident)", async () => {
    // The exact shape the retired v2 endpoint used to return — must NOT be
    // silently accepted as if it were valid v3 data.
    mockFetchOnce(200, { data: { [SOL_MINT]: { price: 150.25 } } });
    await expect(getSolUsdPrice()).rejects.toThrow("Invalid SOL price response");
  });

  it("throws on a non-ok HTTP status instead of swallowing it", async () => {
    mockFetchOnce(404, {});
    await expect(getSolUsdPrice()).rejects.toThrow("Price lookup failed (404)");
  });

  it("throws on a zero price rather than crediting zero-value volume", async () => {
    mockFetchOnce(200, { [SOL_MINT]: { usdPrice: 0 } });
    await expect(getSolUsdPrice()).rejects.toThrow("Invalid SOL price response");
  });

  it("throws on a negative price", async () => {
    mockFetchOnce(200, { [SOL_MINT]: { usdPrice: -5 } });
    await expect(getSolUsdPrice()).rejects.toThrow("Invalid SOL price response");
  });

  it("throws on a non-numeric price", async () => {
    mockFetchOnce(200, { [SOL_MINT]: { usdPrice: "not-a-number" } });
    await expect(getSolUsdPrice()).rejects.toThrow("Invalid SOL price response");
  });

  it("throws on a completely empty body", async () => {
    mockFetchOnce(200, {});
    await expect(getSolUsdPrice()).rejects.toThrow("Invalid SOL price response");
  });
});

describe("getEthUsdPrice", () => {
  it("parses a real CoinGecko simple/price response", async () => {
    mockFetchOnce(200, { ethereum: { usd: 3200.5 } });
    await expect(getEthUsdPrice()).resolves.toBe(3200.5);
  });

  it("throws on non-ok status", async () => {
    mockFetchOnce(429, {});
    await expect(getEthUsdPrice()).rejects.toThrow("ETH price lookup failed (429)");
  });

  it("throws on zero/malformed price rather than crediting zero-value volume", async () => {
    mockFetchOnce(200, { ethereum: { usd: 0 } });
    await expect(getEthUsdPrice()).rejects.toThrow("Invalid ETH price response");
  });
});

describe("getSuiUsdPrice", () => {
  it("parses a real CoinGecko simple/price response", async () => {
    mockFetchOnce(200, { sui: { usd: 3.14 } });
    await expect(getSuiUsdPrice()).resolves.toBe(3.14);
  });

  it("throws on a missing/malformed body", async () => {
    mockFetchOnce(200, { notSui: { usd: 3.14 } });
    await expect(getSuiUsdPrice()).rejects.toThrow("Invalid SUI price response");
  });
});

describe("getBtcUsdPrice", () => {
  it("parses a real CoinGecko simple/price response", async () => {
    mockFetchOnce(200, { bitcoin: { usd: 65000.42 } });
    await expect(getBtcUsdPrice()).resolves.toBe(65000.42);
  });

  it("throws on a missing/malformed body", async () => {
    mockFetchOnce(200, { notBitcoin: { usd: 65000 } });
    await expect(getBtcUsdPrice()).rejects.toThrow("Invalid BTC price response");
  });

  it("throws on non-ok status", async () => {
    mockFetchOnce(429, {});
    await expect(getBtcUsdPrice()).rejects.toThrow("BTC price lookup failed (429)");
  });
});

describe("atomic-unit -> USD conversions", () => {
  it("lamportsToUsd converts 1 SOL (1e9 lamports) at a given price", () => {
    expect(lamportsToUsd(1_000_000_000, 150)).toBe(150);
  });

  it("lamportsToUsd accepts a string amount (as stored/returned by the DB/RPC)", () => {
    expect(lamportsToUsd("500000000", 150)).toBe(75);
  });

  it("weiToUsd converts 1 ETH (1e18 wei) at a given price", () => {
    expect(weiToUsd("1000000000000000000", 3200)).toBe(3200);
  });

  it("mistToUsd converts 1 SUI (1e9 mist) at a given price", () => {
    expect(mistToUsd(1_000_000_000, 3)).toBe(3);
  });
});

describe("formatAtomicAmount", () => {
  it("formats a real atomic amount at 9 decimals (SOL)", () => {
    expect(formatAtomicAmount("1500000000", 9)).toBe("1.5");
  });

  it("caps display precision at 6 decimals even for higher-decimal tokens", () => {
    expect(formatAtomicAmount("1234567891234", 18)).toBe("0.000001");
  });

  it("returns \"0\" for a non-numeric atomic string instead of throwing or returning NaN", () => {
    expect(formatAtomicAmount("not-a-number", 9)).toBe("0");
  });
});
