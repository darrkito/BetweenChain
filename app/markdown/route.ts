import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

// Node runtime (default for route handlers) — needed for the `fs` read,
// same reason app/blog/[slug]/markdown/route.ts isn't inlined into
// middleware.ts (Edge runtime, no Node fs access).
//
// Generic Markdown-for-Agents fallback for every content page that isn't a
// blog post (see middleware.ts's doc comment for the full reasoning) —
// serves public/llms.txt's real content with the correct
// `Content-Type: text/markdown`. Deliberately reuses the existing,
// already-maintained llms.txt rather than generating a fabricated
// per-page markdown transform of React-rendered UI (swap-pair pages, tool
// pages, etc. were never markdown source to begin with) — an honest
// sitewide answer beats an invented page-specific one.
const LLMS_TXT_PATH = path.join(process.cwd(), "public", "llms.txt");

export async function GET() {
  let content: string;
  try {
    content = fs.readFileSync(LLMS_TXT_PATH, "utf8");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
