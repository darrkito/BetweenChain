import { NextResponse } from "next/server";
import { getRelayChains } from "@/lib/chains/relayChains";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Public market data — no auth required. Powers the token-select modal's
// left-hand chain list.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:chains"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const chains = await getRelayChains();
    return NextResponse.json({ chains });
  } catch (err) {
    return safeErrorResponse("tokens/chains", err, 502);
  }
}
