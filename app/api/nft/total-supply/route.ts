import { NextResponse } from "next/server";
import { getMagicEdenListings } from "@/lib/nft/magiceden";
import { getCollectionTotalSupply } from "@/lib/chains/heliusDas";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftVendor } from "@/lib/nft/types";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Solana-only (Magic Eden) — closes the total-supply gap flagged since
// 2026-07-20i via Helius DAS (see lib/chains/heliusDas.ts), which needs a
// real on-chain mint from the collection to resolve the collection address
// in the first place. OpenSea already has total_supply directly on its
// collection-detail response (see lib/nft/opensea.ts) — no separate route
// needed there.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "nft:total-supply"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor") as NftVendor | null;
  const slug = url.searchParams.get("slug");
  if (!vendor || !slug) {
    return NextResponse.json({ error: "vendor and slug query params are required" }, { status: 400 });
  }
  if (vendor !== "magiceden") {
    return NextResponse.json({ error: `Total supply is already included in the collection response for ${vendor}` }, { status: 400 });
  }

  try {
    const listings = await getMagicEdenListings(slug, 0, 1);
    const sampleMint = listings[0]?.tokenId;
    if (!sampleMint) {
      // No active listings at all — no cheap way to find a sample mint for
      // this collection (see heliusDas.ts's comment). Not an error, just an
      // honest "couldn't determine it", same as any other missing stat.
      return NextResponse.json({ totalSupply: null });
    }
    const totalSupply = await getCollectionTotalSupply(sampleMint);
    return NextResponse.json({ totalSupply: totalSupply ?? null });
  } catch (err) {
    return safeErrorResponse("nft/total-supply", err, 502);
  }
}
