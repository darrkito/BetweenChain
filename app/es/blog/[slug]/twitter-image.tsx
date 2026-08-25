import { renderBlogOgImage, OG_IMAGE_SIZE } from "@/lib/seo/ogImage";
import { getBlogPostEs } from "@/lib/content/blog";

// Spanish equivalent of app/blog/[slug]/twitter-image.tsx.
export const runtime = "nodejs";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPostEs(slug);
  return renderBlogOgImage({ title: post?.title ?? "Blockchains.Click", category: post?.category ?? "Blog" });
}
