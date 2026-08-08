import { NextResponse } from "next/server";
import { getJupiterMintUsdPrices } from "@/lib/pricing";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

const MAX_MINTS = 60; // one wallet's realistic token-account count ceiling, not a hard Jupiter limit

/**
 * USD prices for arbitrary Solana SPL mints (2026-08-08, Dust Sweeper) —
 * unlike /api/tokens/balances (curated token list only), this prices
 * WHATEVER mints the caller already found on-chain, since the Dust Sweeper
 * scans a wallet's real token accounts directly (same enumeration
 * DustBurner already does) rather than checking a known list. Public/
 * unauthenticated — mint addresses and their public market prices aren't
 * secret, same reasoning as every other /api/tokens/* route.
 */
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:mint-prices"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const mintsRaw = url.searchParams.get("mints");
  if (!mintsRaw) return NextResponse.json({ error: "mints query param is required" }, { status: 400 });

  const mints = mintsRaw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, MAX_MINTS);
  if (mints.length === 0) return NextResponse.json({ prices: {} });

  try {
    const prices = await getJupiterMintUsdPrices(mints);
    return NextResponse.json({ prices });
  } catch (err) {
    return safeErrorResponse("tokens/mint-prices", err, 502);
  }
}
