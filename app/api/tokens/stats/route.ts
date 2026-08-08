import { NextResponse } from "next/server";
import { getJupiterTokenStats } from "@/lib/chains/jupiter";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Thin client-facing wrapper around lib/chains/jupiter.ts's
// getJupiterTokenStats (server-only) — 2026-08-08, built for the blog's
// live token price/market-cap cards (BlogTokenStats.tsx), same "never bake
// a live figure into static content" principle as the collection
// floor-price card. Public/unauthenticated — a mint address and its public
// market price aren't secret, same reasoning as every other /api/tokens/*
// route.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:stats"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const mint = new URL(req.url).searchParams.get("mint");
  if (!mint) return NextResponse.json({ error: "mint query param is required" }, { status: 400 });

  try {
    const stats = await getJupiterTokenStats(mint);
    return NextResponse.json({ stats });
  } catch (err) {
    return safeErrorResponse("tokens/stats", err, 502);
  }
}
