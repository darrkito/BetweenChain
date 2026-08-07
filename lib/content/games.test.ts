import { describe, it, expect } from "vitest";
import { GAMES, getGame, getAllGames } from "./games";

describe("GAMES content", () => {
  it("has at least one game", () => {
    expect(GAMES.length).toBeGreaterThan(0);
  });

  it("every game has a unique slug", () => {
    const slugs = GAMES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every game has a real playUrl and coverImage (non-empty http(s) URLs)", () => {
    for (const game of GAMES) {
      expect(() => new URL(game.playUrl)).not.toThrow();
      expect(new URL(game.playUrl).protocol).toMatch(/^https?:$/);
      expect(() => new URL(game.coverImage)).not.toThrow();
    }
  });

  it("getGame resolves a known slug and returns undefined for an unknown one", () => {
    const first = GAMES[0];
    expect(getGame(first.slug)?.slug).toBe(first.slug);
    expect(getGame("definitely-not-a-real-game-slug")).toBeUndefined();
  });

  it("getAllGames returns the same list", () => {
    expect(getAllGames()).toEqual(GAMES);
  });
});
