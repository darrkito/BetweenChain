import type { MetadataRoute } from "next";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY } from "@/lib/nft/vendorClients";
import type { NftChainFamily } from "@/lib/nft/types";
import { getAllBlogPosts } from "@/lib/content/blog";
import { SWAP_PAIRS } from "@/lib/content/swapPairs";

const SITE_URL = "https://blockchains.click";

// Real, indexable content per chain family — capped per family to keep this
// bounded/fast (this calls each vendor's real browseCollections(), same
// function the /nft browse page itself uses server-side) rather than
// listing every collection that's ever existed. `/dashboard` deliberately
// excluded — a personalized/wallet-specific utility page, not canonical
// content worth indexing.
const COLLECTIONS_PER_FAMILY = 30;
const CHAIN_FAMILIES: NftChainFamily[] = ["solana", "evm", "move"];

async function nftCollectionEntries(): Promise<MetadataRoute.Sitemap> {
  const results = await Promise.allSettled(
    CHAIN_FAMILIES.map((family) => NFT_VENDOR_CLIENTS[VENDOR_FOR_FAMILY[family]].browseCollections(undefined, COLLECTIONS_PER_FAMILY)),
  );
  const entries: MetadataRoute.Sitemap = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue; // a vendor being down shouldn't break the whole sitemap
    for (const c of result.value) {
      entries.push({
        url: `${SITE_URL}/nft/${c.vendor}/${encodeURIComponent(c.slug)}`,
        changeFrequency: "hourly", // floor/volume/listings move fast, see lib/nft/magiceden.ts's cache-TTL history this session
      });
    }
  }
  return entries;
}

// 2026-08-05 (SEO foundation pass) — this app had no sitemap at all before
// this. /swap added in Phase 2, /faq in Phase 3, /blog + real post entries
// in Phase 4 — each added alongside its own route, never preemptively (a
// sitemap entry for a route that 404s is worse than no entry at all).
// swapPairEntries (2026-08-07) added alongside app/swap/[pair]/page.tsx —
// same principle, and the same bounded SWAP_PAIRS array generateStaticParams
// uses, so this can never list a pair-page slug the route itself doesn't
// actually generate.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/swap`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/nft`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${SITE_URL}/faq`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.7 },
  ];
  const blogEntries: MetadataRoute.Sitemap = getAllBlogPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.date,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  const swapPairEntries: MetadataRoute.Sitemap = SWAP_PAIRS.map((p) => ({
    url: `${SITE_URL}/swap/${p.slug}`,
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  const collectionEntries = await nftCollectionEntries().catch(() => []);
  return [...staticEntries, ...blogEntries, ...swapPairEntries, ...collectionEntries];
}
