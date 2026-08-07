import { describe, it, expect, vi, afterEach } from "vitest";
import { getRelayQuote, SOLANA_CHAIN_ID } from "./relay";

const FAKE_QUOTE_RESPONSE = {
  details: { currencyOut: { amount: "1000", amountFormatted: "1.0", amountUsd: "1.00", currency: { decimals: 18 } } },
};

function mockFetchOnce() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => FAKE_QUOTE_RESPONSE,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRelayQuote — Just-In-Time Gas param plumbing", () => {
  it("omits topupGas entirely when not requested (Relay's own default behavior)", async () => {
    const fetchMock = mockFetchOnce();
    await getRelayQuote({
      amountLamports: "1000000",
      destChainId: 1,
      destToken: "0x0",
      destAddress: "0xabc",
      userSolanaAddress: "solanaAddr",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("topupGas");
    expect(body).not.toHaveProperty("topupGasAmount");
  });

  it("includes topupGas: true with no amount override when requested without a custom amount", async () => {
    const fetchMock = mockFetchOnce();
    await getRelayQuote({
      amountLamports: "1000000",
      destChainId: 1,
      destToken: "0x0",
      destAddress: "0xabc",
      userSolanaAddress: "solanaAddr",
      topupGas: true,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.topupGas).toBe(true);
    expect(body).not.toHaveProperty("topupGasAmount");
  });

  it("includes a custom topupGasAmount only alongside topupGas: true", async () => {
    const fetchMock = mockFetchOnce();
    await getRelayQuote({
      amountLamports: "1000000",
      destChainId: 1,
      destToken: "0x0",
      destAddress: "0xabc",
      userSolanaAddress: "solanaAddr",
      topupGas: true,
      topupGasAmount: "300000",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.topupGas).toBe(true);
    expect(body.topupGasAmount).toBe("300000");
  });

  it("never sends topupGasAmount without topupGas, even if only the amount is passed", async () => {
    const fetchMock = mockFetchOnce();
    await getRelayQuote({
      amountLamports: "1000000",
      destChainId: SOLANA_CHAIN_ID,
      destToken: "SOL",
      destAddress: "solRecipient",
      userSolanaAddress: "solanaAddr",
      topupGasAmount: "300000", // no topupGas: true
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("topupGas");
    expect(body).not.toHaveProperty("topupGasAmount");
  });
});
