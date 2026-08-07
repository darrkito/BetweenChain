import { describe, it, expect, vi, afterEach } from "vitest";
import { getJupiterQuote, NATIVE_SOL_MINT } from "./jupiter";

function mockFetchOnce(response: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => response, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const FAKE_ROUTE_RESPONSE = { inAmount: "1000", outAmount: "2000", otherAmountThreshold: "1980", priceImpactPct: "0.01" };

describe("getJupiterQuote", () => {
  it("defaults to native SOL as the destination mint when none is given (leg-1-of-cross-chain callers, unchanged)", async () => {
    const fetchMock = mockFetchOnce(FAKE_ROUTE_RESPONSE);
    const quote = await getJupiterQuote({ sourceMint: "someSplMint", amount: "1000", slippageBps: 100 });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("outputMint")).toBe(NATIVE_SOL_MINT);
    expect(quote.outputMint).toBe(NATIVE_SOL_MINT);
  });

  it("quotes to an explicit destinationMint (2026-08-07, same-chain SPL<->SPL swaps)", async () => {
    const fetchMock = mockFetchOnce(FAKE_ROUTE_RESPONSE);
    const quote = await getJupiterQuote({
      sourceMint: "mintA",
      destinationMint: "mintB",
      amount: "1000",
      slippageBps: 100,
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("inputMint")).toBe("mintA");
    expect(url.searchParams.get("outputMint")).toBe("mintB");
    expect(quote.outputMint).toBe("mintB");
  });

  it("quotes native SOL as the SOURCE into an arbitrary SPL destination (SOL -> BONK style)", async () => {
    const fetchMock = mockFetchOnce(FAKE_ROUTE_RESPONSE);
    await getJupiterQuote({ sourceMint: NATIVE_SOL_MINT, destinationMint: "bonkMint", amount: "1000", slippageBps: 100 });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("inputMint")).toBe(NATIVE_SOL_MINT);
    expect(url.searchParams.get("outputMint")).toBe("bonkMint");
  });

  it("rejects a same-token quote (source === destination) without calling Jupiter at all", async () => {
    const fetchMock = mockFetchOnce(FAKE_ROUTE_RESPONSE);
    await expect(
      getJupiterQuote({ sourceMint: "sameMint", destinationMint: "sameMint", amount: "1000", slippageBps: 100 }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects native-SOL-to-native-SOL (the implicit default) as a same-token no-op", async () => {
    const fetchMock = mockFetchOnce(FAKE_ROUTE_RESPONSE);
    await expect(getJupiterQuote({ sourceMint: NATIVE_SOL_MINT, amount: "1000", slippageBps: 100 })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
