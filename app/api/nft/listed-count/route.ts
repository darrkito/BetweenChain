import { NextResponse } from "next/server";
import { countOpenSeaListedItems } from "@/lib/nft/opensea";
import { getCryptoPunksOnchainListedCount } from "@/lib/nft/cryptopunksOnchain";
import { CRYPTOPUNKS_SLUG } from "@/lib/nft/cryptopunksShared";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftVendor } from "@/lib/nft/types";

// Deliberately separate from /api/nft/collection — computing an accurate
// listed count for OpenSea costs up to 20 sequential upstream API calls (see
// lib/nft/opensea.ts's countOpenSeaListedItems), so this must stay a
// non-blocking, independently-cached fetch the UI kicks off after the main
// collection page has already rendered, not something the initial page load
// waits on. Magic Eden already returns listedCount for free on the main
// collection endpoint (its /stats call) — no separate route needed there.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "nft:listed-count"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor") as NftVendor | null;
  const slug = url.searchParams.get("slug");
  if (!vendor || !slug) {
    return NextResponse.json({ error: "vendor and slug query params are required" }, { status: 400 });
  }
  if (vendor !== "opensea") {
    return NextResponse.json({ error: `Listed count is already included in the collection response for ${vendor}` }, { status: 400 });
  }

  try {
    // Same CryptoPunks-only on-chain fallback as /api/nft/listings — see
    // lib/nft/cryptopunksOnchain.ts.
    const result = slug === CRYPTOPUNKS_SLUG ? await getCryptoPunksOnchainListedCount() : await countOpenSeaListedItems(slug);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
