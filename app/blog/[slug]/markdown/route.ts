import { NextResponse } from "next/server";
import { getBlogPost } from "@/lib/content/blog";

// Node runtime (default for route handlers) — needed for lib/content/blog.ts's
// Node `fs` reads, which is exactly why middleware.ts rewrites here instead
// of doing this inline (middleware runs on the Edge runtime by default).
//
// Reconstructs a real markdown document: title/description as a proper H1 +
// lede (not just dumping raw frontmatter), the raw MDX body content.ts
// already IS mostly plain markdown, and — since `faq` frontmatter is NOT
// part of the raw MDX body (it only ever fed FAQPage JSON-LD before
// app/components/FaqSection.tsx started rendering it visibly, see that
// component's own doc comment) — a matching "## Frequently asked
// questions" section appended here too, so the markdown representation has
// the same real content an agent would see on the actual rendered page,
// not a subset of it.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) {
    return new NextResponse("Not found", { status: 404 });
  }

  const parts = [`# ${post.title}`, "", post.description, "", post.content.trim()];

  if (post.faq && post.faq.length > 0) {
    parts.push("", "## Frequently asked questions", "");
    for (const item of post.faq) {
      parts.push(`### ${item.question}`, "", item.answer, "");
    }
  }

  return new NextResponse(parts.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // Same real Content-Signal stance as robots.txt (app/robots.ts) —
      // keep both in sync if that policy ever changes.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
