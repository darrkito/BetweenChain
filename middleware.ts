import { NextResponse, type NextRequest } from "next/server";

// Markdown for Agents (2026-08-24, agent-discoverability pass; broadened
// 2026-08-25 after confirming the gap live) — a real, Cloudflare-led
// content-negotiation pattern: a request with `Accept: text/markdown` gets
// a markdown representation instead of the normal HTML page.
//
// Originally scoped to `/blog/:slug` only (blog posts' source is already
// markdown, content/blog/*.mdx). Real gap found 2026-08-25: a third-party
// scanner kept flagging this as unsupported even after that shipped —
// curl confirmed the homepage (`/`) still returned `text/html` regardless
// of `Accept`, since the matcher never covered anything but blog posts. An
// agent's first request to a site is almost always the root/marketing
// pages, not a specific blog post, so this was a real gap, not a false
// scanner flag.
//
// Fix: broadened to match real content routes sitewide (excludes
// api/_next/well-known/static-asset/image-route paths via the negative-
// lookahead below). Blog posts keep their specific per-post markdown
// (app/blog/[slug]/markdown/route.ts — richer than a generic fallback,
// includes the real FAQ section). Every other content page falls back to
// serving public/llms.txt's real content (app/markdown/route.ts) — already
// a genuine, comprehensive markdown description of the whole site's
// capabilities, not a fabricated per-page summary. This is honest: an
// agent asking any non-blog URL for markdown gets the real sitewide
// llms.txt content, not an invented page-specific transform of React UI
// that was never markdown to begin with.
//
// Edge runtime (default for middleware) can't do the Node `fs` reads both
// target route handlers need (lib/content/blog.ts and public/llms.txt are
// read via Node fs) — so this middleware does the cheap header/path check
// only and rewrites to real Node-runtime route handlers that do the file
// reads, same split as the original blog-only version.
export function middleware(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/markdown")) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  const blogSlugMatch = /^\/blog\/([^/]+)$/.exec(url.pathname);
  url.pathname = blogSlugMatch ? `/blog/${blogSlugMatch[1]}/markdown` : "/markdown";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    // Everything except: api routes, well-known, Next internals, the
    // image-response routes (opengraph-image/twitter-image/icon are binary,
    // not content), robots.txt/sitemap.xml/llms.txt (already real
    // text files at their own canonical paths, no negotiation needed on
    // them specifically), and any path containing a literal file extension
    // (static assets).
    "/((?!api/|\\.well-known/|_next/static/|_next/image/|opengraph-image|twitter-image|icon\\.|apple-icon\\.|favicon\\.|robots\\.txt|sitemap\\.xml|llms\\.txt|.*\\..*).*)",
  ],
};
