import { renderBlogOgImage, OG_IMAGE_SIZE } from "@/lib/seo/ogImage";
import { getBlogPost } from "@/lib/content/blog";
import { swapChainForSlug } from "@/lib/chains/swapChains";

// Explicit — same known Turbopack+edge-runtime bug with next/og's
// ImageResponse the root-level opengraph-image.tsx already works around.
export const runtime = "nodejs";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  // Only pass real, resolved chains — an unrecognized slug or anything
  // other than exactly 2 falls back to renderBlogOgImage's existing
  // no-chains layout rather than a broken/partial badge row.
  const resolvedChains = (post?.chains ?? []).map(swapChainForSlug).filter((c): c is NonNullable<typeof c> => Boolean(c));
  return renderBlogOgImage({
    title: post?.title ?? "Blockchains.Click",
    category: post?.category ?? "Blog",
    chains: resolvedChains.length === 2 ? resolvedChains : undefined,
  });
}
