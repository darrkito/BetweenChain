import { describe, expect, it } from "vitest";
import { collectionFallbackMetadata } from "./metadataFallback";

describe("collectionFallbackMetadata", () => {
  it("never noindexes and keeps the canonical (failed lookup ≠ missing page)", () => {
    const m = collectionFallbackMetadata("magiceden", "famous_fox_federation");
    expect(m).not.toHaveProperty("robots");
    expect(m.title).toBe("Famous Fox Federation");
    expect(m.alternates.canonical).toBe("/nft/magiceden/famous_fox_federation");
  });

  it("humanizes dashed slugs and encodes special characters in the canonical", () => {
    expect(collectionFallbackMetadata("opensea", "unioverse-heroes-2").title).toBe("Unioverse Heroes 2");
    expect(collectionFallbackMetadata("tradeport", "0x1::pkg::Nft").alternates.canonical).toBe("/nft/tradeport/0x1%3A%3Apkg%3A%3ANft");
  });

  it("does not use a raw contract address as a title", () => {
    expect(collectionFallbackMetadata("opensea", "0x" + "a".repeat(40)).title).toBe("Collection");
  });
});
