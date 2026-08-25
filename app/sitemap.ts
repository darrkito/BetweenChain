import type { MetadataRoute } from "next";
import { NFT_VENDOR_CLIENTS, VENDOR_FOR_FAMILY } from "@/lib/nft/vendorClients";
import type { NftChainFamily } from "@/lib/nft/types";
import { getAllBlogPosts, getAllBlogPostsEs } from "@/lib/content/blog";
import { SWAP_PAIRS, SWAP_PAIRS_UPDATED } from "@/lib/content/swapPairs";
import { getAllGames } from "@/lib/content/games";
import { getAllBaskets } from "@/lib/content/baskets";
import { EN_TO_ES_BLOG_SLUG, ES_TO_EN_BLOG_SLUG } from "@/lib/content/blogEsMap";

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
  // lastModified only set where a real, hand-maintained date exists (this
  // file itself substantively changed 2026-08-18: homepage title flip,
  // /faq title, /nft's new FAQ section — same "bump on every substantive
  // edit" discipline as blogEntries/gameEntries/basketEntries below, NOT
  // stamped with today's date on every build regardless of whether
  // anything changed, which Google's own sitemap guidance explicitly
  // warns against). Pages not touched in that pass are left without one
  // rather than fabricating a date — same "null, never fabricated" policy
  // this codebase applies everywhere else.
  const RECENT_STATIC_EDIT = "2026-08-18";
  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: RECENT_STATIC_EDIT, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/swap`, lastModified: "2026-08-11", changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/nft`, lastModified: RECENT_STATIC_EDIT, changeFrequency: "hourly", priority: 0.8 },
    // Added 2026-08-19 (homegrown crawl audit) — real gap: /nft's default
    // view only ever links to its Solana-family collections (the default
    // tab); EVM and Sui collections (83 of 192 sitemap URLs) were only
    // reachable by following the NftChainTabs link to these two query
    // variants first — real `<Link>`s (a JS-capable crawler follows them
    // fine), but neither variant was itself in the sitemap, so a crawler
    // that discovers pages sitemap-first had no direct path to ~40% of
    // the site's NFT collection pages. Confirmed via a full site crawl's
    // own internal-link graph before adding these.
    { url: `${SITE_URL}/nft?family=evm`, lastModified: RECENT_STATIC_EDIT, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE_URL}/nft?family=move`, lastModified: RECENT_STATIC_EDIT, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE_URL}/faq`, lastModified: RECENT_STATIC_EDIT, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/games`, lastModified: "2026-08-07", changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/dust-sweeper`, lastModified: "2026-08-24", changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/basket`, lastModified: "2026-08-24", changeFrequency: "weekly", priority: 0.7 },
    // Real gap found 2026-08-24 (SEO/GEO foundation audit): /radar existed as
    // a real, linked, indexable page but was never added to the sitemap.
    { url: `${SITE_URL}/radar`, lastModified: "2026-08-24", changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/pay/create`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/orders`, lastModified: "2026-08-08", changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/evac`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/sentinel-shield`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/burner-shield`, changeFrequency: "monthly", priority: 0.6 },
    // Added 2026-08-19 (SEO checklist audit) -- real gap, this app had no
    // Privacy Policy or Terms page at all before this.
    { url: `${SITE_URL}/privacy`, lastModified: "2026-08-19", changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: "2026-08-19", changeFrequency: "yearly", priority: 0.3 },
  ];
  const blogEntries: MetadataRoute.Sitemap = getAllBlogPosts().map((post) => {
    const esSlug = EN_TO_ES_BLOG_SLUG[post.slug];
    return {
      url: `${SITE_URL}/blog/${post.slug}`,
      // Real gap found 2026-08-18 (SEO Tier 3 audit): this always used the
      // original publish date, even for a post with a real updatedDate set
      // (BlogPostMeta's own field, already rendered visibly on the post
      // page when it differs from date — see app/blog/[slug]/page.tsx's
      // hasRealUpdate) — the sitemap was silently understating freshness
      // for exactly the posts that had genuinely been revised.
      lastModified: post.updatedDate ?? post.date,
      changeFrequency: "monthly",
      priority: 0.6,
      ...(esSlug ? { alternates: { languages: { "en-US": `${SITE_URL}/blog/${post.slug}`, "es-419": `${SITE_URL}/es/blog/${esSlug}` } } } : {}),
    };
  });
  // 2026-08-25 (ES content expansion) — Spanish blog entries, hreflang
  // paired back to their English source via the same map.
  const blogEsEntries: MetadataRoute.Sitemap = getAllBlogPostsEs().map((post) => ({
    url: `${SITE_URL}/es/blog/${post.slug}`,
    lastModified: post.updatedDate ?? post.date,
    changeFrequency: "monthly",
    priority: 0.6,
    alternates: {
      languages: {
        "en-US": `${SITE_URL}/blog/${ES_TO_EN_BLOG_SLUG[post.slug]}`,
        "es-419": `${SITE_URL}/es/blog/${post.slug}`,
      },
    },
  }));
  const gameEntries: MetadataRoute.Sitemap = getAllGames().map((g) => ({
    url: `${SITE_URL}/games/${g.slug}`,
    lastModified: g.addedDate,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  const swapPairEntries: MetadataRoute.Sitemap = SWAP_PAIRS.map((p) => ({
    url: `${SITE_URL}/swap/${p.slug}`,
    lastModified: SWAP_PAIRS_UPDATED,
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  const basketEntries: MetadataRoute.Sitemap = getAllBaskets().map((b) => ({
    url: `${SITE_URL}/basket/${b.slug}`,
    lastModified: b.addedDate,
    changeFrequency: "monthly",
    priority: 0.6,
  }));
  const collectionEntries = await nftCollectionEntries().catch(() => []);
  return [...staticEntries, ...blogEntries, ...blogEsEntries, ...gameEntries, ...swapPairEntries, ...basketEntries, ...collectionEntries];
}
