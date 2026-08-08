import { NextResponse } from "next/server";
import { getSolUsdPrice, getSuiUsdPrice } from "@/lib/pricing";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Thin client-facing wrapper around lib/pricing.ts's getSolUsdPrice/
// getSuiUsdPrice (both server-only) — originally built Solana-only for the
// Meme Radar's $10/$50/$100 quick-buy chips (2026-08-07), extended
// 2026-08-08 with an optional `symbol` param (exactly the extension point
// this route's own prior comment invited) for the blog's live collection
// floor-price cards, which need a SUI/USD conversion for Sui-chain
// collections (Popkins). `solUsdPrice` stays in the response body
// unconditionally for backward compatibility with existing callers that
// never pass `symbol`.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:price"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const symbol = new URL(req.url).searchParams.get("symbol");

  try {
    if (symbol === "sui") {
      const suiUsdPrice = await getSuiUsdPrice();
      return NextResponse.json({ suiUsdPrice });
    }
    const solUsdPrice = await getSolUsdPrice();
    return NextResponse.json({ solUsdPrice });
  } catch (err) {
    return safeErrorResponse("tokens/price", err, 502);
  }
}
