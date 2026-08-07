import type { Metadata } from "next";
import { getMagicEdenListings } from "@/lib/nft/magiceden";
import { getOpenSeaListings } from "@/lib/nft/opensea";
import { getCryptoPunksOnchainListings } from "@/lib/nft/cryptopunksOnchain";
import { CRYPTOPUNKS_SLUG } from "@/lib/nft/cryptopunksShared";
import { getTradeportListings } from "@/lib/nft/tradeport";
import { NFT_VENDOR_CLIENTS } from "@/lib/nft/vendorClients";
import { getSolUsdPrice, getEthUsdPrice } from "@/lib/pricing";
import { CollectionPageClient } from "./CollectionPageClient";
import type { NftListing, NftVendor } from "@/lib/nft/types";

const PAGE_SIZE = 20;

interface InitialListingsPage {
  listings: NftListing[];
  nextCursor?: string;
}

/**
 * First-page-only mirror of app/api/nft/listings/route.ts's vendor
 * dispatch (view="listed", cursor=undefined — the default state a fresh
 * page load always starts in). Deliberately NOT a shared function with that
 * route: this only ever needs page 1, that route also handles pagination,
 * `view=all`, and Tradeport's `chain` query param (irrelevant here — see
 * CollectionPageClient's fetchPage, which already omits `chain` today,
 * matching this same "sui" default). A real, accepted trade-off, not an
 * oversight: any future fix to the route's listings logic (a new vendor
 * quirk, a pagination bug) needs the same fix mirrored here if it affects
 * page 1 specifically. Kept intentionally small in scope to limit how much
 * can drift.
 */
async function fetchInitialListings(vendor: NftVendor, slug: string): Promise<InitialListingsPage> {
  if (vendor === "magiceden") {
    const listings = await getMagicEdenListings(slug, 0, PAGE_SIZE);
    return { listings, nextCursor: listings.length === PAGE_SIZE ? String(PAGE_SIZE) : undefined };
  }
  if (vendor === "opensea") {
    if (slug === CRYPTOPUNKS_SLUG) return getCryptoPunksOnchainListings(PAGE_SIZE, undefined);
    return getOpenSeaListings(slug, PAGE_SIZE);
  }
  if (vendor === "tradeport") {
    const listings = await getTradeportListings("sui", slug, PAGE_SIZE);
    return { listings, nextCursor: undefined };
  }
  return { listings: [], nextCursor: undefined };
}

/**
 * 2026-08-05 (SEO foundation pass) — real collection name/description/image
 * become the page's actual title/OG image instead of the generic site
 * default, for every collection this app lists. Calls the same
 * client.getCollection(slug) the page body below also calls — NOT a
 * duplicate upstream API request: every vendor client's getCollection is
 * already wrapped in lib/cache.ts's Redis-backed cached() (see lib/nft/
 * magiceden.ts's getMagicEdenCollection etc.), and generateMetadata always
 * runs before the page body in Next's render flow, so the second call hits
 * a warm cache — one extra Redis round-trip, not a second real fetch.
 */
export async function generateMetadata({ params }: { params: Promise<{ vendor: string; slug: string }> }): Promise<Metadata> {
  const { vendor: rawVendor, slug: rawSlug } = await params;
  const vendor = rawVendor as NftVendor;
  const slug = decodeURIComponent(rawSlug);
  const client = NFT_VENDOR_CLIENTS[vendor];
  const collection = client ? await client.getCollection(slug).catch(() => undefined) : undefined;
  if (!collection) return { title: "Collection", robots: { index: false } };
  const title = collection.name;
  const description = collection.description?.trim()
    ? collection.description
    : `Browse and buy ${collection.name} NFTs on Blockchains.Click — pay from any supported chain.`;
  return {
    title,
    description,
    alternates: { canonical: `/nft/${vendor}/${encodeURIComponent(slug)}` },
    openGraph: collection.imageUrl ? { images: [collection.imageUrl] } : undefined,
    twitter: collection.imageUrl ? { images: [collection.imageUrl] } : undefined,
  };
}

/**
 * 2026-08-05 (SSR conversion, real user request) — converted from a client
 * component that fetched both the header and first listings page on mount
 * to a Server Component, same pattern app/nft/page.tsx (the browse page)
 * already used. Real data on first paint instead of two loading skeletons
 * then two client round trips.
 *
 * Both fetches run via Promise.allSettled, NOT Promise.all — this is the
 * exact same lesson lib/nft/magiceden.ts's browseMagicEdenCollections/
 * searchMagicEdenCollections already learned the hard way earlier this
 * session (2026-08-05): the header and listings genuinely hit independent
 * upstream sources/rate-limit buckets on every vendor, and a single Promise.
 * all would let one's failure discard the other's already-successful
 * result. This mirrors CollectionPageClient's OWN pre-SSR fix (the
 * "listings first, header follows, sequenced not gated on success" bug from
 * earlier the same day) at the server layer instead of the client layer.
 *
 * All genuinely interactive behavior (retry, infinite scroll, search,
 * filters, buy modals) lives in CollectionPageClient — see that file.
 */
export default async function NftCollectionPage({ params }: { params: Promise<{ vendor: string; slug: string }> }) {
  const { vendor: rawVendor, slug: rawSlug } = await params;
  const vendor = rawVendor as NftVendor;
  // Same defensive double-decode guard the client version had (real bug
  // found live 2026-07-22, Tradeport slugs containing `::`) — see the old
  // client component's history for the full root-cause writeup. Kept here
  // since Server Component params can arrive already-decoded too.
  const slug = decodeURIComponent(rawSlug);

  const client = NFT_VENDOR_CLIENTS[vendor];

  const [collectionResult, listingsResult, solPriceResult, ethPriceResult] = await Promise.allSettled([
    client ? client.getCollection(slug) : Promise.resolve(undefined),
    client ? fetchInitialListings(vendor, slug) : Promise.resolve({ listings: [], nextCursor: undefined }),
    // 2026-08-07 (cross-chain floor price display) — independent of the
    // collection/listings fetch, same Promise.allSettled reasoning as those
    // two: a price-API hiccup shouldn't affect (or be affected by) real
    // collection data, it just means the secondary converted-price line
    // doesn't render (see NftCollectionStats.tsx).
    getSolUsdPrice(),
    getEthUsdPrice(),
  ]);
  const solUsdPrice = solPriceResult.status === "fulfilled" ? solPriceResult.value : null;
  const ethUsdPrice = ethPriceResult.status === "fulfilled" ? ethPriceResult.value : null;

  const initialCollection = collectionResult.status === "fulfilled" ? (collectionResult.value ?? null) : null;
  const initialCollectionError =
    collectionResult.status === "rejected"
      ? (collectionResult.reason as Error).message
      : collectionResult.status === "fulfilled" && !collectionResult.value
        ? "Collection not found"
        : null;

  const initialListings = listingsResult.status === "fulfilled" ? listingsResult.value.listings : [];
  const initialCursor = listingsResult.status === "fulfilled" ? listingsResult.value.nextCursor : undefined;
  const initialListingsError = listingsResult.status === "rejected" ? (listingsResult.reason as Error).message : null;

  return (
    <CollectionPageClient
      vendor={vendor}
      slug={slug}
      initialCollection={initialCollection}
      initialCollectionError={initialCollectionError}
      initialListings={initialListings}
      initialCursor={initialCursor}
      initialHasMore={Boolean(initialCursor)}
      initialListingsError={initialListingsError}
      solUsdPrice={solUsdPrice}
      ethUsdPrice={ethUsdPrice}
    />
  );
}
