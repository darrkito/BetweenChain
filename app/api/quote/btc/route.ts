import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getChangeNowReverseEstimate, ChangeNowAmountOutOfRangeError, type ChangeNowOriginCurrency } from "@/lib/chains/changenow";
import { isPlausibleEvmAddress, isPlausibleBtcAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const QUOTE_TTL_MS = 10 * 60_000; // matches ChangeNOW's own rateId validity window (see changenow.ts)

// General BTC<->SOL/ETH swaps on /swap (2026-08-08, Phase 2 of BTC support —
// Phase 1 was BTC as a pay-with option for Sui NFT purchases). Deliberately
// a SEPARATE route from /api/quote rather than a new branch inside it:
// /api/quote's whole shape (sourceChainId/destChainId as Relay/Jupiter chain
// ids, jupiter_route/relay_route storage) assumes an on-chain bridge
// execution model. ChangeNOW is custodial (deposit-address, no signable
// "leg 1" transaction the way Jupiter/Relay have) — bolting that onto the
// existing route's branching would risk regressing the highest-traffic
// execution path in this app. Scoped to BTC<->SOL and BTC<->ETH only for
// now (the two ChangeNOW currencies already integrated and live-verified in
// this app — see changenow.ts) — BTC<->other EVM chains (MATIC, AVAX, ...)
// is a real, separate follow-up, not silently promised here.
//
// Only the ChangeNOW "reverse" estimate is used (exact destination amount ->
// required origin amount) — the only mode this app has ever live-verified
// against ChangeNOW's real API (see the NFT-purchase flow). The "direct"
// mode (exact origin amount -> estimated destination amount, the more
// familiar "I'm selling X, what do I get" swap UX) has NOT been verified
// live in this environment and is deliberately not used here rather than
// guessed at. Practical effect: the user always types the amount they want
// to RECEIVE, not the amount they're spending — same shape the NFT-purchase
// flow already uses.
const bodySchema = z.object({
  // Which side of the pair BTC is on.
  direction: z.enum(["receive_btc", "send_btc"]),
  counterCurrency: z.enum(["sol", "eth"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/), // decimal amount of the RECEIVED currency
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

  const receivedCurrency = input.direction === "receive_btc" ? "btc" : input.counterCurrency;
  const fromCurrency: ChangeNowOriginCurrency = input.direction === "receive_btc" ? input.counterCurrency : "btc";

  if (receivedCurrency === "btc") {
    if (!isPlausibleBtcAddress(input.destAddress)) {
      return NextResponse.json({ error: "Invalid Bitcoin destination address" }, { status: 400 });
    }
  } else if (receivedCurrency === "sol") {
    try {
      new (await import("@solana/web3.js")).PublicKey(input.destAddress);
    } catch {
      return NextResponse.json({ error: "Invalid Solana destination address" }, { status: 400 });
    }
  } else if (!isPlausibleEvmAddress(input.destAddress)) {
    return NextResponse.json({ error: "Invalid EVM destination address" }, { status: 400 });
  }

  try {
    const estimate = await getChangeNowReverseEstimate({
      fromCurrency,
      toAmount: input.amount,
      toCurrency: receivedCurrency,
    });

    const db = supabaseAdmin();
    const { data: quoteRow, error } = await db
      .from("swap_quotes")
      .insert({
        user_id: session.userId,
        source_chain: fromCurrency,
        source_mint: fromCurrency.toUpperCase(),
        source_amount: estimate.fromAmount,
        dest_chain: receivedCurrency,
        dest_token: receivedCurrency.toUpperCase(),
        dest_address: input.destAddress,
        expected_output_min: input.amount,
        changenow_rate_id: estimate.rateId,
        changenow_estimate: estimate,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      })
      .select("id, expires_at")
      .single();
    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      fromCurrency,
      fromAmount: estimate.fromAmount,
      toCurrency: receivedCurrency,
      toAmount: input.amount,
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
