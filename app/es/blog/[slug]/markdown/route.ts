import { NextResponse } from "next/server";
import { getBlogPostEs } from "@/lib/content/blog";

// Spanish equivalent of app/blog/[slug]/markdown/route.ts — same reasoning,
// same reconstruction shape, pointed at the ES content directory.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPostEs(slug);
  if (!post) {
    return new NextResponse("Not found", { status: 404 });
  }

  const parts = [`# ${post.title}`, "", post.description, "", post.content.trim()];

  if (post.faq && post.faq.length > 0) {
    parts.push("", "## Preguntas frecuentes", "");
    for (const item of post.faq) {
      parts.push(`### ${item.question}`, "", item.answer, "");
    }
  }

  return new NextResponse(parts.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
