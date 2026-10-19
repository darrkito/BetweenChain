/**
 * 2026-10-19 — metadata for a collection page whose upstream lookup failed.
 *
 * The 2026-08-19 fix added one 500 ms retry but still fell through to
 * `robots: { index: false }`. SEO Watchdog caught it recurring live: 7 Magic
 * Eden sitemap URLs served noindex + a generic "Collection" title during one
 * parallel crawl (cold cache, 5-8 s upstream, rate-limited), and rendered fine
 * when fetched one at a time. A failed lookup can't be told apart from a
 * missing collection here (OpenSea's client returns undefined for any non-OK
 * response, 429 included), and noindexing a real page is far worse than an
 * indexable fallback — so a failure never emits noindex. Title comes from the
 * slug, which is the collection's own identifier.
 */
export function collectionFallbackMetadata(vendor: string, slug: string) {
  const name = slug
    .replace(/^0x[0-9a-f]{40}$/i, "Collection")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
  return {
    title: name || "Collection",
    description: `Browse and buy ${name || "NFT"} NFTs on Blockchains.Click — pay from any supported chain.`,
    alternates: { canonical: `/nft/${vendor}/${encodeURIComponent(slug)}` },
  };
}
