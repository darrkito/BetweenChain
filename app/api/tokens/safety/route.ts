import { NextResponse } from "next/server";
import { getTokenSafety } from "@/lib/chains/rugcheck";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// Solana-only real safety data (RugCheck) for the Meme Radar (2026-08-07).
// Returns { safety: null } — never a fabricated score — for anything
// RugCheck doesn't have a report for.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:safety"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const mint = url.searchParams.get("mint");
  if (!mint) return NextResponse.json({ error: "mint query param is required" }, { status: 400 });

  try {
    const safety = await getTokenSafety(mint);
    return NextResponse.json({ safety });
  } catch (err) {
    return safeErrorResponse("tokens/safety", err, 502);
  }
}
