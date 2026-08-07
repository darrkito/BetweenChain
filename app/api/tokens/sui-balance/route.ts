import { NextResponse } from "next/server";
import { getSuiBalanceMist } from "@/lib/chains/sui";
import { getSuiUsdPrice, mistToUsd } from "@/lib/pricing";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { cached } from "@/lib/cache";
import { safeErrorResponse } from "@/lib/apiError";

const BALANCE_TTL_MS = 15_000; // same as /api/tokens/balances

/**
 * Native-SUI-only balance lookup (2026-08-07, portfolio drawer) —
 * `lib/chains/sui.ts` has no multi-coin balance function (only
 * `getSuiBalanceMist`, native SUI), so this route is deliberately scoped
 * the same way, not a general Sui token-holdings endpoint. Public/
 * unauthenticated, same reasoning as /api/tokens/balances — a wallet
 * address and its public on-chain balance aren't secret.
 */
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:sui-balance"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const owner = url.searchParams.get("owner");
  if (!owner) return NextResponse.json({ error: "owner query param is required" }, { status: 400 });

  try {
    const result = await cached(`sui-balance:${owner}`, BALANCE_TTL_MS, async () => {
      const mist = await getSuiBalanceMist(owner);
      const suiUsdPrice = await getSuiUsdPrice().catch(() => null);
      const balance = (Number(mist) / 1e9).toString();
      return {
        balance,
        balanceUsd: suiUsdPrice ? mistToUsd(mist.toString(), suiUsdPrice).toFixed(2) : null,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    return safeErrorResponse("tokens/sui-balance", err, 502);
  }
}
