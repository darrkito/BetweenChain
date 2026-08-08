import { NextResponse } from "next/server";
import { z } from "zod";
import { cached } from "@/lib/cache";
import { getChangeNowDirectEstimate, ChangeNowAmountOutOfRangeError } from "@/lib/chains/changenow";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

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
  sourceCurrency: z.enum(["btc", "sol", "eth"]),
  sourceAmount: z.string().regex(/^\d+(\.\d+)?$/),
  destCurrency: z.enum(["btc", "sol", "eth"]),
});

export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "quote:btc:preview"), 40, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  if (input.sourceCurrency === input.destCurrency || (input.sourceCurrency !== "btc" && input.destCurrency !== "btc")) {
    return NextResponse.json({ destAmountFormatted: null, destAmountUsd: null, route: [], feeBreakdown: [], autoRefuelAvailable: false });
  }
  if (Number(input.sourceAmount) <= 0) {
    return NextResponse.json({ destAmountFormatted: "0", destAmountUsd: null, route: [], feeBreakdown: [], autoRefuelAvailable: false });
  }

  const cacheKey = `preview:btc:${input.sourceCurrency}:${input.sourceAmount}:${input.destCurrency}`;

  try {
    const result = await cached(cacheKey, PREVIEW_TTL_MS, async () => {
      const estimate = await getChangeNowDirectEstimate({
        fromCurrency: input.sourceCurrency,
        fromAmount: input.sourceAmount,
        toCurrency: input.destCurrency,
      });
      return {
        destAmountFormatted: estimate.toAmount,
        // No USD price source is wired into this preview — the real quote
        // (POST /api/quote/btc) is the source of truth for execution; this
        // is a live estimate only. null, never fabricated.
        destAmountUsd: null,
        route: [],
        feeBreakdown: [],
        autoRefuelAvailable: false,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ChangeNowAmountOutOfRangeError) {
      return NextResponse.json({ destAmountFormatted: null, destAmountUsd: null, route: [], feeBreakdown: [], autoRefuelAvailable: false });
    }
    return safeErrorResponse("quote/btc/preview", err, 502);
  }
}
