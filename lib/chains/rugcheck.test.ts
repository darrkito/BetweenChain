import { describe, it, expect, vi, afterEach } from "vitest";
import { getTokenSafety } from "./rugcheck";

function mockFetchOnce(response: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTokenSafety", () => {
  it("maps a real RugCheck report shape into TokenSafety", async () => {
    mockFetchOnce({
      mint: "mintAAA",
      mintAuthority: null,
      freezeAuthority: null,
      totalHolders: 4200,
      rugged: false,
      score: 850,
      score_normalised: 87,
      risks: [{ name: "Low liquidity", description: "...", level: "warn" }],
    });

    const safety = await getTokenSafety("mintAAA");
    expect(safety).toEqual({
      mint: "mintAAA",
      score: 87,
      rugged: false,
      mintAuthorityRenounced: true,
      freezeAuthorityRenounced: true,
      totalHolders: 4200,
      risks: ["Low liquidity"],
    });
  });

  it("reflects non-renounced authorities as false, never assumed true", async () => {
    mockFetchOnce({
      mint: "mintBBB",
      mintAuthority: "someAuthorityAddress",
      freezeAuthority: "someFreezeAddress",
      rugged: false,
      score: 100,
      score_normalised: 10,
      risks: [],
    });

    const safety = await getTokenSafety("mintBBB");
    expect(safety?.mintAuthorityRenounced).toBe(false);
    expect(safety?.freezeAuthorityRenounced).toBe(false);
  });

  it("returns null (never a fabricated score) when RugCheck 404s an unknown mint", async () => {
    mockFetchOnce({}, false);
    const safety = await getTokenSafety("mintCCC-unknown");
    expect(safety).toBeNull();
  });

  it("returns null on a network failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const safety = await getTokenSafety("mintDDD-network-error");
    expect(safety).toBeNull();
  });
});
