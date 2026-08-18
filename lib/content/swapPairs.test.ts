import { describe, it, expect } from "vitest";
import { EVM_CHAINS } from "@/lib/nft/evmChains";
import { SWAP_PAIRS, pairForSlug, relatedPairs, swapPairCopy } from "./swapPairs";

const RELAY_PAIRS = SWAP_PAIRS.filter((p) => p.engine === "relay");
const CHANGENOW_PAIRS = SWAP_PAIRS.filter((p) => p.engine === "changenow");

describe("SWAP_PAIRS", () => {
  it("has exactly 2 relay entries per configured EVM chain (Solana<->chain, both directions)", () => {
    // Was a hardcoded "12" until this went stale the moment Robinhood
    // Chain became the 7th EVM_CHAINS entry (2026-08-08) — asserted against
    // EVM_CHAINS' own length now so a future chain addition can't silently
    // desync this test again.
    expect(RELAY_PAIRS).toHaveLength(EVM_CHAINS.length * 2);
  });

  it("every relay pair includes Solana on exactly one side", () => {
    for (const p of RELAY_PAIRS) {
      const solanaOnFrom = p.from.slug === "solana";
      const solanaOnTo = p.to.slug === "solana";
      expect(solanaOnFrom !== solanaOnTo).toBe(true);
    }
  });

  // changenow pairs (2026-08-18) deliberately don't follow the
  // Solana-on-one-side rule above — bitcoin-to-ethereum and
  // bitcoin-to-sui/sui-to-bitcoin involve neither Solana nor an EVM chain
  // on one side, by design (see lib/content/swapPairs.ts's own doc on why
  // these were scoped the way they are).
  it("has exactly 10 changenow pairs, each involving bitcoin or sui on both sides distinctly", () => {
    expect(CHANGENOW_PAIRS).toHaveLength(10);
    for (const p of CHANGENOW_PAIRS) {
      expect(p.from.slug).not.toBe(p.to.slug);
      const involvesBtcOrSui = (slug: string) => slug === "bitcoin" || slug === "sui";
      expect(involvesBtcOrSui(p.from.slug) || involvesBtcOrSui(p.to.slug)).toBe(true);
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

  // changenow pairs (2026-08-18) — never state the relay-only 0.25% fee
  // (confirmed against lib/chains/changenow.ts: no feeBps/feeAccount param
  // exists on any ChangeNOW call this app makes), same accuracy bar the
  // public/llms.txt audit fixed for the AI-facing capability doc.
  it("never states the relay-only 0.25% fee on a changenow pair", () => {
    const copy = swapPairCopy(pairForSlug("solana-to-bitcoin")!);
    const allText = [copy.intro, ...copy.howItWorks, ...copy.faq.map((f) => f.answer)].join(" ");
    expect(allText).not.toMatch(/0\.25%/);
    expect(copy.faq.some((f) => /no separate blockchains\.click platform fee/i.test(f.answer))).toBe(true);
  });

  it("substitutes the real chain labels for a bitcoin/sui pair in both directions", () => {
    const copy = swapPairCopy(pairForSlug("bitcoin-to-sui")!);
    expect(copy.intro).toContain("Bitcoin");
    expect(copy.intro).toContain("Sui");

    const reverseCopy = swapPairCopy(pairForSlug("sui-to-bitcoin")!);
    expect(reverseCopy.intro).toContain("Sui directly into Bitcoin");
  });
});
