import { NextResponse } from "next/server";
import { getMagicEdenWalletHoldings } from "@/lib/nft/magiceden";
import { getTradeportWalletHoldings } from "@/lib/nft/tradeport";
import { isTradeportChain, TRADEPORT_CHAINS } from "@/lib/nft/vendorClients";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Games Hub collection-ownership check (2026-08-07) — given a connected
// wallet address and one of the collections a game links to, returns the
// real NFTs that wallet actually owns from it. Public/unauthenticated (a
// wallet address and its real on-chain holdings aren't secret — same
// reasoning as every other public wallet-balance route in this app) but
// rate-limited.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "games:collection-holdings"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor");
  const slug = url.searchParams.get("slug");
  const owner = url.searchParams.get("owner");
  const rawChain = url.searchParams.get("chain");
  if (!vendor || !slug || !owner) {
    return NextResponse.json({ error: "vendor, slug, and owner query params are required" }, { status: 400 });
  }

  try {
    if (vendor === "magiceden") {
      const owned = await getMagicEdenWalletHoldings(owner, slug);
      return NextResponse.json({ owned });
    }
    if (vendor === "tradeport") {
      if (!rawChain || !isTradeportChain(rawChain)) {
        return NextResponse.json({ error: `chain query param must be one of: ${TRADEPORT_CHAINS.join(", ")}` }, { status: 400 });
      }
      const owned = await getTradeportWalletHoldings(rawChain, owner, slug);
      return NextResponse.json({ owned });
    }
    // OpenSea (EVM) ownership isn't wired up yet — no game currently links
    // an EVM collection, and OpenSea's own wallet-holdings endpoint hasn't
    // been researched/verified. Real gap, not silently pretended to work.
    return NextResponse.json({ owned: [] });
  } catch (err) {
    return safeErrorResponse("games/collection-holdings", err, 502);
  }
}
