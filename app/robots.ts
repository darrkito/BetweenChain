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
      {
        userAgent: "*",
        // /api/mcp carved out of the blanket /api/ disallow below (2026-08-25,
        // agent-discoverability pass) — longest-match wins per the robots.txt
        // spec, so this allow rule (9 chars) beats the disallow (4 chars)
        // for that one path without touching the crawl-budget reasoning for
        // the rest of /api/. Real, working MCP server — see app/api/mcp/route.ts.
        allow: ["/", "/api/mcp"],
        disallow: "/api/",
        // Content Signals (2026-08-24, agent-discoverability pass) — a real,
        // emerging directive (contentsignals.org, Cloudflare-backed) distinct
        // from the AI-crawler allowlisting below: those control WHETHER a bot
        // may fetch pages at all, this declares stated PREFERENCES for what
        // fetched content may be used for. search=yes/ai-input=yes because
        // AI-citation visibility is the explicit goal of this site's whole
        // SEO/GEO effort; ai-train=no is a deliberate, reversible default
        // (declines model-training consent specifically, doesn't affect
        // search/answer-engine use) — revisit if the business stance on
        // training-data consent changes. Next.js's `other` field passes
        // per-rule directives through verbatim (see RobotsRuleBase's own
        // doc comment) — this isn't a first-class allow/disallow field.
        other: { "Content-Signal": "ai-train=no, search=yes, ai-input=yes" },
      },
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
      // Added 2026-08-19 (SEO playbook §17 checklist import) — three more
      // real AI/agent crawlers the original 2026-08-05 list missed:
      // Firecrawl's own crawler (used by many AI agent/RAG pipelines to
      // ingest a site), Andi's answer-engine crawler, and Exa's search-API
      // crawler (also used as retrieval backing for several AI products).
      { userAgent: "FirecrawlAgent", allow: "/" },
      { userAgent: "AndiBot", allow: "/" },
      { userAgent: "ExaBot", allow: "/" },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
