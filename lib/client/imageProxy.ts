/**
 * Routes an external (unbounded-host) image URL through this app's own
 * same-origin proxy (app/api/img/route.ts) so next/image can serve it
 * without needing that host allowlisted in next.config.ts's remotePatterns.
 * Shared by every component that renders token/NFT images from arbitrary
 * third-party hosts (TokenIcon, NftImage, NftCollectionHero,
 * NftCollectionsGrid) — chain-icon components with a fixed known host
 * (NftChainTabs, EvmChainSubTabs) don't need this, they point next/image
 * straight at the real (allowlisted) URL.
 *
 * `width` (2026-08-18, Lighthouse perf pass) — optional, forwarded as
 * `?w=` to the proxy so it resizes/reencodes server-side instead of
 * shipping whatever full-resolution original the source happens to have
 * (next/image's own resizing is disabled site-wide, see
 * next.config.ts's `images.unoptimized` comment). Omit for call sites
 * where the source is already close to display size (rare) or where a
 * specific size doesn't make sense.
 */
export function proxiedImageUrl(src: string, width?: number): string {
  const params = new URLSearchParams({ url: src });
  if (width) params.set("w", String(width));
  return `/api/img?${params}`;
}
