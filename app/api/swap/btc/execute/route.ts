import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createChangeNowExchange, type ChangeNowOriginCurrency } from "@/lib/chains/changenow";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({ quoteId: z.string().uuid() });

/**
 * Creates the actual ChangeNOW exchange for a general BTC<->SOL/ETH swap —
 * the side-effecting counterpart to /api/quote/btc, same split as the Sui
 * NFT-purchase flow's own quote/execute pair
 * (app/api/nft/purchase/sui/execute/route.ts, which this mirrors). Re-reads
 * the rateId/fromAmount/destAddress bound at quote time from the DB, never
 * from client input, so the destination stays immutable end to end.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "swap:btc:execute"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: quote, error: quoteErr } = await db
    .from("swap_quotes")
    .select("*")
    .eq("id", parsed.data.quoteId)
    .eq("user_id", session.userId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (quoteErr || !quote || !quote.changenow_rate_id) {
    return NextResponse.json({ error: "Quote not found, expired, or already used" }, { status: 400 });
  }

  const { error: consumeErr } = await db
    .from("swap_quotes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", quote.id)
    .is("consumed_at", null); // race guard: only succeeds for the first caller
  if (consumeErr) return NextResponse.json({ error: "Failed to consume quote" }, { status: 500 });

  const { data: swapTx, error: insertErr } = await db
    .from("swap_transactions")
    .insert({ quote_id: quote.id, user_id: session.userId, status: "leg1_pending" })
    .select("id")
    .single();
  if (insertErr || !swapTx) return NextResponse.json({ error: "Failed to create swap transaction" }, { status: 500 });

  try {
    const exchange = await createChangeNowExchange({
      fromCurrency: quote.source_chain as ChangeNowOriginCurrency,
      fromAmount: quote.source_amount,
      rateId: quote.changenow_rate_id,
      payoutAddress: quote.dest_address,
      toCurrency: quote.dest_chain,
    });

    await db
      .from("swap_transactions")
      .update({
        status: "leg1_confirmed",
        changenow_exchange_id: exchange.id,
        changenow_deposit_address: exchange.depositAddress,
        leg1_confirmed_at: new Date().toISOString(),
      })
      .eq("id", swapTx.id);

    return NextResponse.json({
      swapId: swapTx.id,
      status: "leg1_confirmed",
      depositAddress: exchange.depositAddress,
      depositAmount: exchange.fromAmount,
      depositCurrency: quote.source_chain,
    });
  } catch (err) {
    await db.from("swap_transactions").update({ status: "leg1_failed" }).eq("id", swapTx.id);
    return safeErrorResponse("swap/btc/execute", err, 502);
  }
}
