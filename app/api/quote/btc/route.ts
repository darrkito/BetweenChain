import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getChangeNowDirectEstimate, ChangeNowAmountOutOfRangeError, type ChangeNowOriginCurrency } from "@/lib/chains/changenow";
import { isPlausibleEvmAddress, isPlausibleBtcAddress, isPlausibleSuiAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// General BTC/SUI<->SOL/ETH swaps on /swap, embedded directly in the main
// Sell/Buy pickers (2026-08-08b — Bitcoin is a real, selectable "chain" in
// SwapPanel's picker via lib/chains/swapChains.ts's BTC_CHAIN_ID, same
// picker every other chain uses; Sui added 2026-08-18 the same way via
// SUI_CHAIN_ID). Deliberately a SEPARATE route from /api/quote rather than
// a new branch inside it — see that route's/this file's earlier version
// doc for why (ChangeNOW's custodial model has no signable "leg 1" the way
// Jupiter/Relay do). Despite the URL/directory still saying "btc" (kept to
// avoid an unnecessary rename of a working route), this route and its
// execute/confirm siblings are currency-agnostic — see changenow.ts's
// ChangeNowOriginCurrency, now "eth" | "sol" | "btc" | "sui".
//
// Uses ChangeNOW's "direct" (forward) estimate mode — sourceAmount is what
// the user actually typed into the Sell field (their spend amount),
// destAmount is the estimate shown as the Buy-side preview — matching the
// same "type how much you're selling" UX every other pair in this app
// already uses. Verified live before switching to this from the previous
// reverse-only design (see STATE.md 2026-08-08c/d).
const bodySchema = z.object({
  sourceCurrency: z.enum(["btc", "sol", "eth", "sui"]),
  sourceAmount: z.string().regex(/^\d+(\.\d+)?$/),
  destCurrency: z.enum(["btc", "sol", "eth", "sui"]),
  destAddress: z.string().min(1),
});

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "quote:btc"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  if (input.sourceCurrency === input.destCurrency) {
    return NextResponse.json({ error: "Sell and Buy can't be the same currency" }, { status: 400 });
  }
  const CHANGENOW_ONLY_CURRENCIES = new Set(["btc", "sui"]);
  if (!CHANGENOW_ONLY_CURRENCIES.has(input.sourceCurrency) && !CHANGENOW_ONLY_CURRENCIES.has(input.destCurrency)) {
    return NextResponse.json({ error: "This route only handles pairs involving BTC or Sui" }, { status: 400 });
  }

  if (input.destCurrency === "sol") {
    try {
      new (await import("@solana/web3.js")).PublicKey(input.destAddress);
    } catch {
      return NextResponse.json({ error: "Invalid Solana destination address" }, { status: 400 });
    }
  } else if (input.destCurrency === "btc") {
    if (!isPlausibleBtcAddress(input.destAddress)) {
      return NextResponse.json({ error: "Invalid Bitcoin destination address" }, { status: 400 });
    }
  } else if (input.destCurrency === "sui") {
    if (!isPlausibleSuiAddress(input.destAddress)) {
      return NextResponse.json({ error: "Invalid Sui destination address" }, { status: 400 });
    }
  } else if (!isPlausibleEvmAddress(input.destAddress)) {
    return NextResponse.json({ error: "Invalid EVM destination address" }, { status: 400 });
  }

  try {
    const estimate = await getChangeNowDirectEstimate({
      fromCurrency: input.sourceCurrency,
      fromAmount: input.sourceAmount,
      toCurrency: input.destCurrency,
    });

    const db = supabaseAdmin();
    const { data: quoteRow, error } = await db
      .from("swap_quotes")
      .insert({
        user_id: session.userId,
        source_chain: input.sourceCurrency,
        source_mint: input.sourceCurrency.toUpperCase(),
        // ChangeNOW's own echoed fromAmount, not the raw client input —
        // same "never persist an unconfirmed client claim when the vendor
        // has already validated and echoed the real figure" discipline as
        // every other quote-bound amount in this app.
        source_amount: estimate.fromAmount,
        dest_chain: input.destCurrency,
        dest_token: input.destCurrency.toUpperCase(),
        dest_address: input.destAddress,
        expected_output_min: estimate.toAmount,
        changenow_rate_id: estimate.rateId,
        changenow_estimate: estimate,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), // matches ChangeNOW's own rateId validity window
      })
      .select("id, expires_at")
      .single();
    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      fromCurrency: input.sourceCurrency as ChangeNowOriginCurrency,
      fromAmount: estimate.fromAmount,
      toCurrency: input.destCurrency,
      toAmount: estimate.toAmount,
    });
  } catch (err) {
    if (err instanceof ChangeNowAmountOutOfRangeError) {
      return NextResponse.json(
        { error: `Amount out of range — ChangeNOW supports between ${err.minAmount} and ${err.maxAmount} ${err.fromCurrency.toUpperCase()}` },
        { status: 400 },
      );
    }
    return safeErrorResponse("quote/btc", err, 502);
  }
}
