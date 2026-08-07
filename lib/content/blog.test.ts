import { describe, it, expect } from "vitest";
import { getAllBlogPosts, getBlogPost } from "./blog";

// Real integration tests against the real content/blog/*.mdx files (same
// "real data, no mocks" discipline lib/points.test.ts already uses for
// server-only modules) — no filesystem mocking, this is exactly what
// readPostFile actually parses in production.
describe("blog frontmatter — optional field backward compatibility", () => {
  it("existing posts that predate the new optional fields parse with them undefined, not throwing", () => {
    const posts = getAllBlogPosts();
    expect(posts.length).toBeGreaterThan(0);
    const preExisting = posts.find((p) => p.slug === "how-cross-chain-swaps-work");
    expect(preExisting).toBeTruthy();
    expect(preExisting?.updatedDate).toBeUndefined();
    expect(preExisting?.chains).toBeUndefined();
    expect(preExisting?.howTo).toBeUndefined();
    expect(preExisting?.faq).toBeUndefined();
  });
});

describe("blog frontmatter — new optional fields", () => {
  const post = getBlogPost("how-to-swap-sol-to-eth");

  it("parses the example post's real frontmatter", () => {
    expect(post).toBeTruthy();
  });

  it("parses chains as a real string array", () => {
    expect(post?.chains).toEqual(["solana", "ethereum"]);
  });

  it("parses howTo with real steps", () => {
    expect(post?.howTo?.steps.length).toBeGreaterThan(0);
    expect(post?.howTo?.steps[0]).toHaveProperty("name");
    expect(post?.howTo?.steps[0]).toHaveProperty("text");
  });

  it("parses faq with real question/answer pairs", () => {
    expect(post?.faq?.length).toBeGreaterThan(0);
    expect(post?.faq?.[0]).toHaveProperty("question");
    expect(post?.faq?.[0]).toHaveProperty("answer");
  });

  it("has no updatedDate — this post has never actually been revised, so it doesn't fabricate one", () => {
    expect(post?.updatedDate).toBeUndefined();
  });
});
