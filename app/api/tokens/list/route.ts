import { NextResponse } from "next/server";
import { getTokenListForChain } from "@/lib/chains/tokenList";
import { rateLimit, clientKey } from "@/lib/rate-limit";

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
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
