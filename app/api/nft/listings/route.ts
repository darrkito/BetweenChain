import { NextResponse } from "next/server";
import { getMagicEdenListings } from "@/lib/nft/magiceden";
import { getOpenSeaListings, getOpenSeaAllAssets, getOpenSeaCollection } from "@/lib/nft/opensea";
import { getCryptoPunksOnchainListings } from "@/lib/nft/cryptopunksOnchain";
import { CRYPTOPUNKS_SLUG } from "@/lib/nft/cryptopunksShared";
import { getTradeportListings, isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/tradeport";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing, NftVendor } from "@/lib/nft/types";

const PAGE_SIZE = 20;

// Collection items for the buy grid, paginated for infinite scroll.
// `view=listed` (default) returns currently-buyable items; `view=all` (OpenSea
// only, see lib/nft/opensea.ts's getOpenSeaAllAssets) returns full collection
// inventory regardless of listing status. Magic Eden and Tradeport have no
// confirmed "all items" endpoint in their public APIs — `view=all` for those
// vendors falls back to the same listed-only result rather than 400ing, since
// a client-side toggle shouldn't hard-fail just because one vendor can't
// serve it (the UI disables the "All" tab for non-OpenSea collections instead
// — see app/nft/[vendor]/[slug]/page.tsx).
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "nft:listings"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor") as NftVendor | null;
  const slug = url.searchParams.get("slug");
  const view = url.searchParams.get("view") === "all" ? "all" : "listed";
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (!vendor || !slug) {
    return NextResponse.json({ error: "vendor and slug query params are required" }, { status: 400 });
  }

  try {
    if (vendor === "magiceden") {
      const offset = cursor ? Number(cursor) : 0;
      const listings = await getMagicEdenListings(slug, offset, PAGE_SIZE);
      const nextCursor = listings.length === PAGE_SIZE ? String(offset + PAGE_SIZE) : undefined;
      return NextResponse.json({ listings, nextCursor });
    }

    if (vendor === "opensea") {
      // CryptoPunks-only: OpenSea's public Listings API genuinely returns
      // zero for this collection (confirmed live 2026-08-03 — see
      // lib/nft/cryptopunksOnchain.ts's file comment) even though it trades
      // actively, because it predates Seaport and trades through its own
      // native marketplace mechanism. Read real listings straight from the
      // contract instead. "All items" is unaffected — getOpenSeaAllAssets
      // already returns full inventory regardless of listing status.
      if (slug === CRYPTOPUNKS_SLUG && view === "listed") {
        const page = await getCryptoPunksOnchainListings(PAGE_SIZE, cursor);
        return NextResponse.json(page);
      }
      const page = view === "all" ? await getOpenSeaAllAssets(slug, PAGE_SIZE, cursor) : await getOpenSeaListings(slug, PAGE_SIZE, cursor);
      // Detects the exact CryptoPunks pattern (see lib/nft/cryptopunksOnchain.ts)
      // for any OTHER collection: a real floor price with zero listings from
      // the standard Seaport-based endpoint almost always means the
      // collection trades through a non-standard/pre-Seaport mechanism
      // OpenSea's public Listings API can't see. Only checked on the first
      // page (cursor undefined) — no point repeating this on every scroll
      // page of a collection that's already known to be genuinely sparse.
      // A cheap cached call (COLLECTIONS_TTL_MS, likely already warm — the
      // client fetches the same collection in parallel), so this costs
      // nothing extra in the common case. Logged, not thrown — an empty
      // grid still renders fine on its own; this is purely so the NEXT
      // occurrence shows up in server logs immediately instead of needing a
      // full investigation to rediscover the same root cause.
      if (view === "listed" && !cursor && page.listings.length === 0) {
        const collection = await getOpenSeaCollection(slug).catch(() => undefined);
        if (collection?.floorPrice != null && Number(collection.floorPrice) > 0) {
          console.warn(
            `[nft/listings] OpenSea collection "${slug}" has a real floor price (${collection.floorPrice} ${collection.floorPriceCurrency}) but zero listings from the Seaport listings endpoint — likely trades through a non-standard/pre-Seaport marketplace mechanism (same pattern as CryptoPunks). Consider an on-chain fallback like lib/nft/cryptopunksOnchain.ts.`,
          );
        }
      }
      return NextResponse.json(page);
    }

    if (vendor === "tradeport") {
      // No cursor pagination wired for Tradeport yet — unverified vendor
      // (see lib/nft/tradeport.ts), not worth building pagination against
      // query shapes that haven't been confirmed against a real key/schema.
      // `chain` is validated (not just cast) — see TRADEPORT_CHAINS's export
      // comment on why an unchecked value here is a real GraphQL-injection risk.
      const rawChain = url.searchParams.get("chain");
      if (rawChain != null && !isTradeportChain(rawChain)) {
        return NextResponse.json({ error: `chain query param must be one of: ${TRADEPORT_CHAINS.join(", ")}` }, { status: 400 });
      }
      const chain = rawChain ?? "sui";
      const listings: NftListing[] = await getTradeportListings(chain, slug, PAGE_SIZE);
      return NextResponse.json({ listings });
    }

    return NextResponse.json({ listings: [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
