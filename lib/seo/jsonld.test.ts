import { describe, it, expect } from "vitest";
import { howToSchema } from "./jsonld";

describe("howToSchema", () => {
  it("builds real step URLs from the pair's slug and each step's id", () => {
    const schema = howToSchema({
      slug: "how-to-swap-sol-to-eth",
      name: "Swap SOL to ETH",
      summary: "Convert Solana to Ethereum in a few clicks.",
      steps: [
        { id: "connect-your-wallets", name: "Connect your wallets", text: "Connect Phantom and an EVM wallet." },
        { id: "pick-tokens-and-preview", name: "Pick tokens and preview", text: "Choose SOL and ETH, review the live quote." },
      ],
    });
    expect(schema["@type"]).toBe("HowTo");
    expect(schema.step).toHaveLength(2);
    expect(schema.step[0].url).toBe("https://blockchains.click/blog/how-to-swap-sol-to-eth#connect-your-wallets");
    expect(schema.step[1].url).toBe("https://blockchains.click/blog/how-to-swap-sol-to-eth#pick-tokens-and-preview");
  });

  it("states the real fee, not a fabricated cost figure", () => {
    const schema = howToSchema({ slug: "x", name: "x", summary: "x", steps: [{ id: "a", name: "a", text: "a" }] });
    expect(schema.estimatedCost.value).toContain("0.25%");
    expect(schema.estimatedCost.value).toContain("per swap leg");
  });

  it("omits totalTime/tool when not provided, includes them when they are", () => {
    const withoutExtras = howToSchema({ slug: "x", name: "x", summary: "x", steps: [{ id: "a", name: "a", text: "a" }] });
    expect(withoutExtras).not.toHaveProperty("totalTime");
    expect(withoutExtras).not.toHaveProperty("tool");

    const withExtras = howToSchema({
      slug: "x",
      name: "x",
      summary: "x",
      totalTime: "PT5M",
      tools: ["Phantom Wallet", "MetaMask"],
      steps: [{ id: "a", name: "a", text: "a" }],
    });
    expect(withExtras.totalTime).toBe("PT5M");
    expect(withExtras.tool).toEqual([
      { "@type": "HowToTool", name: "Phantom Wallet" },
      { "@type": "HowToTool", name: "MetaMask" },
    ]);
  });
});
