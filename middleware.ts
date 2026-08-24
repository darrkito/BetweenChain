import { NextResponse, type NextRequest } from "next/server";

// Markdown for Agents (2026-08-24, agent-discoverability pass) — a real,
// Cloudflare-led content-negotiation pattern: a request with
// `Accept: text/markdown` gets a markdown representation instead of the
// normal HTML page. Scoped to `/blog/:slug` only — blog posts are the one
// content type on this site whose SOURCE is already markdown
// (content/blog/*.mdx, see lib/content/blog.ts), so serving it directly is
// a natural, cheap fit. Swap-pair/tool pages are React-rendered UI, not
// prose content — forcing a markdown representation there would be a much
// larger, lower-value effort and isn't attempted here.
//
// Edge runtime (default for middleware) can't do the Node `fs` reads
// lib/content/blog.ts needs (it's explicitly `import "server-only"`) — so
// this middleware does the cheap header check only and rewrites to a real
// Node-runtime route handler (app/blog/[slug]/markdown/route.ts) that does
// the actual file read, rather than trying to inline that logic here.
export function middleware(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/markdown")) {
    const url = request.nextUrl.clone();
    url.pathname = `${url.pathname}/markdown`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/blog/:slug",
};
