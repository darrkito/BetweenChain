import { NextResponse } from "next/server";
import { countOpenSeaListedItems } from "@/lib/nft/opensea";
import { getMagicEdenCollectionStats } from "@/lib/nft/magiceden";
import { getCryptoPunksOnchainListedCount } from "@/lib/nft/cryptopunksOnchain";
import { CRYPTOPUNKS_SLUG } from "@/lib/nft/cryptopunksShared";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftVendor } from "@/lib/nft/types";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
// 2026-08-04: bumped 30 -> 60, matches app/api/nft/collection/route.ts's
// identical change — the Magic Eden branch here uses the same
// fetchMagicEden retry budget (~55s worst case).
export const maxDuration = 60;

// Deliberately separate from /api/nft/collection — computing an accurate
// listed count for OpenSea costs up to 20 sequential upstream API calls (see
// lib/nft/opensea.ts's countOpenSeaListedItems), so this must stay a
// non-blocking, independently-cached fetch the UI kicks off after the main
// collection page has already rendered, not something the initial page load
// waits on.
//
// Magic Eden branch added 2026-08-04 (real bug, user report): this used to
// assume Magic Eden's listedCount/floorPrice came "for free" bundled into
// the main /api/nft/collection response — that bundling was itself the bug
// (doubled Magic Eden's per-page request count, making the header fail more
// often than listings under its tight rate limit — see
// lib/nft/magiceden.ts's getMagicEdenCollection doc comment for the full
// root-cause). Now Magic Eden's stats live here too, same deferred/
// non-blocking shape as OpenSea's.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "nft:listed-count"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor") as NftVendor | null;
  const slug = url.searchParams.get("slug");
  if (!vendor || !slug) {
    return NextResponse.json({ error: "vendor and slug query params are required" }, { status: 400 });
  }
  if (vendor !== "opensea" && vendor !== "magiceden") {
    return NextResponse.json({ error: `Listed count is not supported for ${vendor}` }, { status: 400 });
  }

  try {
    if (vendor === "magiceden") {
      const stats = await getMagicEdenCollectionStats(slug);
      return NextResponse.json({
        count: stats.listedCount ?? 0,
        approximate: false,
        floorPrice: stats.floorPrice,
        floorPriceCurrency: stats.floorPriceCurrency,
        // 7d, not 24h — see lib/nft/magiceden.ts's RawMagicEdenStats comment.
        volume: stats.volume7d,
        volumeCurrency: stats.volume7dCurrency,
        volumePeriodDays: 7,
      });
    }
    // Same CryptoPunks-only on-chain fallback as /api/nft/listings — see
    // lib/nft/cryptopunksOnchain.ts.
    const result = slug === CRYPTOPUNKS_SLUG ? await getCryptoPunksOnchainListedCount() : await countOpenSeaListedItems(slug);
    return NextResponse.json(result);
  } catch (err) {
    return safeErrorResponse("nft/listed-count", err, 502);
  }
}
