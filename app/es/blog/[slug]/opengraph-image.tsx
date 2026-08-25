import { renderBlogOgImage, OG_IMAGE_SIZE } from "@/lib/seo/ogImage";
import { getBlogPostEs } from "@/lib/content/blog";
import { swapChainForSlug } from "@/lib/chains/swapChains";

// Spanish equivalent of app/blog/[slug]/opengraph-image.tsx — same logic,
// pointed at the ES content directory. Without this, /es/blog/[slug]'s
// coverImageUrl (`${postUrl}/opengraph-image`) would 404 for every ES post,
// since ES slugs don't exist in the English route's getBlogPost() lookup.
export const runtime = "nodejs";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPostEs(slug);
  const resolvedChains = (post?.chains ?? []).map(swapChainForSlug).filter((c): c is NonNullable<typeof c> => Boolean(c));
  return renderBlogOgImage({
    title: post?.title ?? "Blockchains.Click",
    category: post?.category ?? "Blog",
    chains: resolvedChains.length === 2 ? resolvedChains : undefined,
  });
}
