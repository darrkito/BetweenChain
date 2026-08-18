import { NextResponse } from "next/server";
import { z } from "zod";
import { cached } from "@/lib/cache";
import { getChangeNowDirectEstimate, ChangeNowAmountOutOfRangeError } from "@/lib/chains/changenow";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";
import { getSolUsdPrice, getEthUsdPrice, getSuiUsdPrice, getBtcUsdPrice } from "@/lib/pricing";

const PRICE_TTL_MS = 30_000; // prices move far slower than a 5s quote — cached separately, per-currency, not per-pair

// Real gap found live 2026-08-18 (user report): this preview always
// returned destAmountUsd: null, and never priced the Sell side for a
// SUI/BTC sell token at all (SwapPanel's own client-side USD calc only
// covers native SOL) — meaning neither side showed a $ figure for any
// BTC/Sui-involving pair. All four price sources already exist in
// lib/pricing.ts (used elsewhere for NFT points-crediting) — reused here,
// each cached 30s to stay well under Jupiter/CoinGecko's rate limits.
async function getUsdPrice(currency: "btc" | "sol" | "eth" | "sui"): Promise<number | null> {
  const fetcher = { btc: getBtcUsdPrice, sol: getSolUsdPrice, eth: getEthUsdPrice, sui: getSuiUsdPrice }[currency];
  try {
    return await cached(`price:usd:${currency}`, PRICE_TTL_MS, fetcher);
  } catch {
    return null; // never fabricated — UI shows no $ figure rather than a wrong one
  }
}

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const PREVIEW_TTL_MS = 5_000; // matches /api/quote/preview's own TTL

// Public, unauthenticated live preview for a BTC<->SOL/ETH pair — mirrors
// app/api/quote/preview's role (SwapPanel's live "how much would I get" as
// the user types) for the one pair shape that route doesn't cover. Creates
// nothing, binds nothing — same "preview vs. execute" split as the rest of
// this app (see that route's own doc).
const querySchema = z.object({
  sourceCurrency: z.enum(["btc", "sol", "eth", "sui"]),
  // Leading digit before the decimal point is optional (".5" is a real
  // value some mobile decimal keypads produce with no auto-inserted "0")
  // — see SwapPageClient.tsx's handleSellAmountChange doc for the client
  // fix; this is defense-in-depth for any other caller of this route.
  sourceAmount: z.string().regex(/^\d*\.?\d+$/),
  destCurrency: z.enum(["btc", "sol", "eth", "sui"]),
});

export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "quote:btc:preview"), 40, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  const CHANGENOW_ONLY_CURRENCIES = new Set(["btc", "sui"]);
  if (
    input.sourceCurrency === input.destCurrency ||
    (!CHANGENOW_ONLY_CURRENCIES.has(input.sourceCurrency) && !CHANGENOW_ONLY_CURRENCIES.has(input.destCurrency))
  ) {
    return NextResponse.json({
      destAmountFormatted: null,
      destAmountUsd: null,
      sourceAmountUsd: null,
      route: [],
      feeBreakdown: [],
      autoRefuelAvailable: false,
    });
  }
  if (Number(input.sourceAmount) <= 0) {
    return NextResponse.json({
      destAmountFormatted: "0",
      destAmountUsd: null,
      sourceAmountUsd: null,
      route: [],
      feeBreakdown: [],
      autoRefuelAvailable: false,
    });
  }

  const cacheKey = `preview:btc:${input.sourceCurrency}:${input.sourceAmount}:${input.destCurrency}`;

  try {
    const result = await cached(cacheKey, PREVIEW_TTL_MS, async () => {
      const [estimate, sourceUsdPrice, destUsdPrice] = await Promise.all([
        getChangeNowDirectEstimate({
          fromCurrency: input.sourceCurrency,
          fromAmount: input.sourceAmount,
          toCurrency: input.destCurrency,
        }),
        getUsdPrice(input.sourceCurrency),
        getUsdPrice(input.destCurrency),
      ]);
      return {
        destAmountFormatted: estimate.toAmount,
        destAmountUsd: destUsdPrice != null ? (Number(estimate.toAmount) * destUsdPrice).toFixed(2) : null,
        sourceAmountUsd: sourceUsdPrice != null ? (Number(input.sourceAmount) * sourceUsdPrice).toFixed(2) : null,
        route: [],
        feeBreakdown: [],
        autoRefuelAvailable: false,
        error: null as string | null,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ChangeNowAmountOutOfRangeError) {
      // Real bug found live 2026-08-18 (user report, testing a small SUI
      // amount): this used to swallow the range error into a bare null
      // preview with zero explanation — the field just silently stayed
      // empty as the user typed, with no indication why. The real POST
      // /api/quote/btc route already surfaces this exact message on
      // submit; the live preview should say the same thing as the user
      // types, not stay silent until they hit Confirm.
      return NextResponse.json({
        destAmountFormatted: null,
        destAmountUsd: null,
        sourceAmountUsd: null,
        route: [],
        feeBreakdown: [],
        autoRefuelAvailable: false,
        error: `Amount out of range — ChangeNOW supports between ${err.minAmount} and ${err.maxAmount} ${err.fromCurrency.toUpperCase()}`,
      });
    }
    return safeErrorResponse("quote/btc/preview", err, 502);
  }
}
