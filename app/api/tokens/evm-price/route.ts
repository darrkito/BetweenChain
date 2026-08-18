import { NextResponse } from "next/server";
import { z } from "zod";
import { getEvmTokenUsdPrices, getEvmNativeUsdPrice } from "@/lib/pricing";
import { RELAY_NATIVE_EVM_SENTINEL } from "@/lib/chains/relay";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Sell-side USD for an arbitrary EVM token (2026-08-18) — SwapPanel's
// Sell-side USD previously only ever covered native SOL (see that file's
// sellPriceUsd effect); this is its EVM counterpart, mirroring the exact
// price sources /api/tokens/balances already established for the wallet-
// holdings picker: native currency via getEvmNativeUsdPrice (honestly null
// for chains with no known CoinGecko id), ERC20 contracts via
// getEvmTokenUsdPrices. Public/unauthenticated — same reasoning as every
// other /api/tokens/* route (chain id + contract address + public market
// price, nothing secret).
const querySchema = z.object({
  chainId: z.string().regex(/^\d+$/),
  address: z.string().min(1),
});

export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "tokens:evm-price"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const chainId = Number(parsed.data.chainId);
  const address = parsed.data.address;
  const isNative = address.toLowerCase() === RELAY_NATIVE_EVM_SENTINEL.toLowerCase();

  try {
    if (isNative) {
      const price = await getEvmNativeUsdPrice(chainId);
      return NextResponse.json({ price });
    }
    const prices = await getEvmTokenUsdPrices(chainId, [address]);
    return NextResponse.json({ price: prices[address.toLowerCase()] ?? null });
  } catch (err) {
    return safeErrorResponse("tokens/evm-price", err, 502);
  }
}
