import { NextResponse } from "next/server";
import { getTokenListForChain } from "@/lib/chains/tokenList";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Public market data — no auth required. Powers the token-select modal's
// right-hand token list and the top trending bar.
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:list"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const chainIdRaw = url.searchParams.get("chainId");
  const term = url.searchParams.get("term") ?? undefined;

  const chainId = Number(chainIdRaw);
  if (!chainIdRaw || !Number.isInteger(chainId)) {
    return NextResponse.json({ error: "chainId query param is required" }, { status: 400 });
  }

  try {
    const tokens = await getTokenListForChain(chainId, term);
    return NextResponse.json({ tokens });
  } catch (err) {
    return safeErrorResponse("tokens/list", err, 502);
  }
}
