import { NextResponse } from "next/server";
import { getTrendingForChain } from "@/lib/chains/trending";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Exposes lib/chains/trending.ts (already used server-side by
// lib/chains/tokenList.ts's featured-token ordering) directly to a client
// component — new for the Meme Radar page (2026-08-07), first direct
// consumer.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:trending"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const chainIdRaw = url.searchParams.get("chainId");
  const chainId = Number(chainIdRaw);
  if (!chainIdRaw || !Number.isInteger(chainId)) {
    return NextResponse.json({ error: "chainId query param is required" }, { status: 400 });
  }

  try {
    const tokens = await getTrendingForChain(chainId);
    return NextResponse.json({ tokens });
  } catch (err) {
    return safeErrorResponse("tokens/trending", err, 502);
  }
}
