import { describe, it, expect } from "vitest";
import { socialLinks } from "./CollectionSocialsBar";

describe("socialLinks", () => {
  it("returns an empty array when a collection has no social fields", () => {
    expect(socialLinks({})).toEqual([]);
  });

  it("builds a link per present field, in a fixed order", () => {
    const links = socialLinks({
      externalUrl: "https://pudgypenguins.com",
      twitterUsername: "pudgypenguins",
      discordUrl: "https://discord.gg/pudgypenguins",
      telegramUrl: "https://t.me/pudgypenguins",
    });
    expect(links.map((l) => l.label)).toEqual(["Official website", "X (Twitter)", "Discord", "Telegram"]);
    expect(links[1].href).toBe("https://x.com/pudgypenguins");
  });

  it("rejects a javascript: URL rather than rendering it", () => {
    const links = socialLinks({ externalUrl: "javascript:alert(1)" });
    expect(links).toEqual([]);
  });

  it("rejects a malformed URL rather than throwing", () => {
    const links = socialLinks({ discordUrl: "not a url" });
    expect(links).toEqual([]);
  });
});
