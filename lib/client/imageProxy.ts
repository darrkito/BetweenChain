/**
 * Routes an external (unbounded-host) image URL through this app's own
 * same-origin proxy (app/api/img/route.ts) so next/image can serve it
 * without needing that host allowlisted in next.config.ts's remotePatterns.
 * Shared by every component that renders token/NFT images from arbitrary
 * third-party hosts (TokenIcon, NftImage, NftCollectionHero,
 * NftCollectionsGrid) — chain-icon components with a fixed known host
 * (NftChainTabs, EvmChainSubTabs) don't need this, they point next/image
 * straight at the real (allowlisted) URL.
 */
export function proxiedImageUrl(src: string): string {
  return `/api/img?url=${encodeURIComponent(src)}`;
}
