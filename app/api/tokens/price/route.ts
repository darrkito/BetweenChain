import { NextResponse } from "next/server";
import { getSolUsdPrice } from "@/lib/pricing";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Thin client-facing wrapper around lib/pricing.ts's getSolUsdPrice
// (server-only) — needed by the Meme Radar's $10/$50/$100 quick-buy chips
// to convert a USD preset into a SOL sellAmount before handing off to
// /swap (2026-08-07). Solana-only for now; extend with a `symbol` param if
// a future caller needs ETH/SUI.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:price"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const solUsdPrice = await getSolUsdPrice();
    return NextResponse.json({ solUsdPrice });
  } catch (err) {
    return safeErrorResponse("tokens/price", err, 502);
  }
}
