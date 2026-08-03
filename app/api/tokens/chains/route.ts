import { NextResponse } from "next/server";
import { getRelayChains } from "@/lib/chains/relayChains";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// Public market data — no auth required. Powers the token-select modal's
// left-hand chain list.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:chains"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const chains = await getRelayChains();
    return NextResponse.json({ chains });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
