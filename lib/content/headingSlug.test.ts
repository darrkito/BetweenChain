import { describe, it, expect } from "vitest";
import { slugifyHeading, rehypeHeadingIds, extractHeadings } from "./headingSlug";

describe("slugifyHeading", () => {
  it("lowercases, strips punctuation, and hyphenates spaces", () => {
    expect(slugifyHeading("Connect Your Wallets")).toBe("connect-your-wallets");
    expect(slugifyHeading("Pick Tokens & Preview the Route!")).toBe("pick-tokens-preview-the-route");
  });

  it("collapses repeated hyphens", () => {
    expect(slugifyHeading("A   B - - C")).toBe("a-b-c");
  });
});

describe("extractHeadings", () => {
  it("extracts every H2 with a slug matching slugifyHeading", () => {
    const source = `Some intro text.\n\n## Connect Your Wallets\n\nBody text.\n\n### Not an H2\n\n## Pick Tokens\n`;
    const headings = extractHeadings(source);
    expect(headings).toEqual([
      { id: "connect-your-wallets", text: "Connect Your Wallets" },
      { id: "pick-tokens", text: "Pick Tokens" },
    ]);
  });

  it("returns an empty array for content with no H2s", () => {
    expect(extractHeadings("Just a paragraph, no headings.")).toEqual([]);
  });
});

describe("rehypeHeadingIds", () => {
  it("sets a real id on h2 nodes matching extractHeadings' id for the same text", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {} as Record<string, unknown>,
          children: [{ type: "text", value: "Connect Your Wallets" }],
        },
        {
          type: "element",
          tagName: "p",
          properties: {} as Record<string, unknown>,
          children: [{ type: "text", value: "Not a heading" }],
        },
      ],
    };
    rehypeHeadingIds()(tree);
    expect(tree.children[0].properties.id).toBe("connect-your-wallets");
    expect(tree.children[1].properties.id).toBeUndefined();
    // Same id extractHeadings would produce for the identical heading text.
    expect(tree.children[0].properties.id).toBe(extractHeadings("## Connect Your Wallets\n")[0].id);
  });
});
