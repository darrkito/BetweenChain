import type { MetadataRoute } from "next";

const SITE_URL = "https://blockchains.click";

// 2026-08-05 (SEO foundation pass) — ported from /home/darrkito/
// luvory-genius-generator's real robots.txt: explicitly allowlists AI
// crawlers (GPTBot, ChatGPT-User, Google-Extended, Anthropic-AI, ClaudeBot,
// PerplexityBot) alongside standard search bots, a deliberate choice for
// answer-engine/AI-search visibility rather than leaving it to each
// crawler's own default behavior. /api/* disallowed — nothing there is
// content meant to be indexed, and every route already enforces its own
// auth/rate-limiting regardless (this is just a crawl-budget signal, not a
// security boundary).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      { userAgent: "GPTBot", allow: "/" },
      // OAI-SearchBot (2026-08-06 GEO pass) — a distinct OpenAI crawler from
      // GPTBot: search-time retrieval for ChatGPT's live web search feature,
      // not training-time crawling. Both are worth allowlisting explicitly.
      { userAgent: "OAI-SearchBot", allow: "/" },
      { userAgent: "ChatGPT-User", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "Anthropic-AI", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
