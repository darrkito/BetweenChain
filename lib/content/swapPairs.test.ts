import { describe, it, expect } from "vitest";
import { EVM_CHAINS } from "@/lib/nft/evmChains";
import { SWAP_PAIRS, pairForSlug, relatedPairs, swapPairCopy } from "./swapPairs";

describe("SWAP_PAIRS", () => {
  it("has exactly 2 entries per configured EVM chain (Solana<->chain, both directions)", () => {
    // Was a hardcoded "12" until this went stale the moment Robinhood
    // Chain became the 7th EVM_CHAINS entry (2026-08-08) — asserted against
    // EVM_CHAINS' own length now so a future chain addition can't silently
    // desync this test again.
    expect(SWAP_PAIRS).toHaveLength(EVM_CHAINS.length * 2);
  });

  it("every pair includes Solana on exactly one side", () => {
    for (const p of SWAP_PAIRS) {
      const solanaOnFrom = p.from.slug === "solana";
      const solanaOnTo = p.to.slug === "solana";
      expect(solanaOnFrom !== solanaOnTo).toBe(true);
    }
  });

  it("has no duplicate slugs", () => {
    const slugs = SWAP_PAIRS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("pairForSlug", () => {
  it("resolves a real slug", () => {
    const pair = pairForSlug("solana-to-ethereum");
    expect(pair?.from.slug).toBe("solana");
    expect(pair?.to.slug).toBe("ethereum");
  });

  it("resolves the reverse direction as a distinct pair", () => {
    const pair = pairForSlug("ethereum-to-solana");
    expect(pair?.from.slug).toBe("ethereum");
    expect(pair?.to.slug).toBe("solana");
  });

  it("returns undefined for an unrecognized slug", () => {
    expect(pairForSlug("base-to-arbitrum")).toBeUndefined();
    expect(pairForSlug("not-a-real-pair")).toBeUndefined();
  });
});

describe("relatedPairs", () => {
  it("excludes the pair itself and only returns pairs sharing a chain", () => {
    const pair = pairForSlug("solana-to-ethereum")!;
    const related = relatedPairs(pair);
    expect(related.every((p) => p.slug !== pair.slug)).toBe(true);
    expect(related.every((p) => p.from.slug === "solana" || p.to.slug === "ethereum")).toBe(true);
  });

  it("respects the limit", () => {
    const pair = pairForSlug("solana-to-ethereum")!;
    expect(relatedPairs(pair, 2)).toHaveLength(2);
  });
});

describe("swapPairCopy", () => {
  it("states the single-leg 0.25% fee, not a per-leg/0.5% figure", () => {
    const pair = pairForSlug("solana-to-base")!;
    const copy = swapPairCopy(pair);
    expect(copy.intro).toContain("flat 0.25% platform fee");
    expect(copy.intro).not.toMatch(/0\.5%/);
    expect(copy.faq[0].answer).toContain("0.25%");
  });

  it("never states a fabricated speed/time guarantee", () => {
    const pair = pairForSlug("solana-to-avalanche")!;
    const copy = swapPairCopy(pair);
    const allText = [copy.intro, ...copy.howItWorks, ...copy.faq.map((f) => f.answer)].join(" ").toLowerCase();
    expect(allText).not.toMatch(/\d+\s*second/);
    expect(allText).not.toContain("instant");
  });

  it("substitutes the real chain labels for both directions", () => {
    const copy = swapPairCopy(pairForSlug("solana-to-polygon")!);
    expect(copy.intro).toContain("Solana");
    expect(copy.intro).toContain("Polygon");

    const reverseCopy = swapPairCopy(pairForSlug("polygon-to-solana")!);
    expect(reverseCopy.intro).toContain("Polygon to Solana");
  });
});
