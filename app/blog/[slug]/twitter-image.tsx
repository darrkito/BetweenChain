import { renderBlogOgImage, OG_IMAGE_SIZE } from "@/lib/seo/ogImage";
import { getBlogPost } from "@/lib/content/blog";

// Explicit — same known Turbopack+edge-runtime bug with next/og's
// ImageResponse the root-level opengraph-image.tsx already works around.
export const runtime = "nodejs";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  return renderBlogOgImage({ title: post?.title ?? "Blockchains.Click", category: post?.category ?? "Blog" });
}
