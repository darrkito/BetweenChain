import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isTradeportListingStillActive, type TradeportChain } from "@/lib/nft/tradeport";
import { buildVerifiedTradeportBuyTransaction } from "@/lib/nft/tradeportBuy";
import { createChangeNowExchange, type ChangeNowOriginCurrency } from "@/lib/chains/changenow";
import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/chains/sui";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({ quoteId: z.string().uuid() });

/**
 * Consumes an nft_purchase_quotes row (vendor='tradeport'). Same two-shape
 * branch as the OpenSea execute route (see that file's doc):
 * - Same-chain (bridge_quote is null): no deposit leg — builds the Tradeport
 *   buy transaction fresh (staleness re-check + real transaction, not a
 *   cached one) and returns it serialized for one Sui-wallet signature.
 * - Cross-chain: creates the actual ChangeNOW exchange and returns its
 *   deposit address for a PLAIN native-ETH transfer (no contract call,
 *   unlike Relay/Squid) — the buyer's own Sui wallet only gets involved in
 *   step 2, once the bridged SUI has actually landed (see confirm-deposit).
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:sui:execute"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: quote, error: quoteErr } = await db
    .from("nft_purchase_quotes")
    .select("*")
    .eq("id", parsed.data.quoteId)
    .eq("user_id", session.userId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (quoteErr || !quote) {
    return NextResponse.json({ error: "Quote not found, expired, or already used" }, { status: 400 });
  }

  const { error: consumeErr } = await db
    .from("nft_purchase_quotes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", quote.id)
    .is("consumed_at", null);
  if (consumeErr) return NextResponse.json({ error: "Failed to consume quote" }, { status: 500 });

  const { data: purchase, error: insertErr } = await db
    .from("nft_purchases")
    .insert({ quote_id: quote.id, user_id: session.userId, status: "pending" })
    .select("id")
    .single();
  if (insertErr || !purchase) return NextResponse.json({ error: "Failed to create NFT purchase" }, { status: 500 });

  if (!quote.bridge_quote) {
    // Same-chain path.
    try {
      const stillActive = await isTradeportListingStillActive(quote.move_chain as TradeportChain, quote.tradeport_listing_id);
      if (!stillActive) {
        await db.from("nft_purchases").update({ status: "listing_gone", updated_at: new Date().toISOString() }).eq("id", purchase.id);
        return NextResponse.json({ purchaseId: purchase.id, status: "listing_gone" });
      }
      // Real dry-run cost + real balance check — the CRITICAL fix (see
      // lib/chains/sui.ts's doc): never hand back a signable transaction
      // without first confirming the buyer's wallet can actually afford
      // its true on-chain cost (which can meaningfully exceed the raw
      // listing price — Tradeport's own fees aren't visible in the
      // GraphQL data at all).
      const verified = await buildVerifiedTradeportBuyTransaction({
        listingId: quote.tradeport_listing_id,
        walletAddress: quote.dest_address,
      });
      if (!verified.sufficient) {
        await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
        // costMist is null when the dry run failed outright (severely
        // underfunded) rather than succeeding with a known exact cost —
        // fall back to the same listing-price + safety-margin estimate the
        // quote route used, clearly an estimate rather than an exact figure.
        const requiredSui =
          verified.costMist != null ? Number(verified.costMist) / 1e9 : Number(quote.listing_price) * (1 + TRADEPORT_FEE_SAFETY_MARGIN);
        return NextResponse.json({
          purchaseId: purchase.id,
          status: "insufficient_funds",
          requiredSui: requiredSui.toString(),
          balanceSui: (Number(verified.balanceMist) / 1e9).toString(),
        });
      }
      await db.from("nft_purchases").update({ status: "deposit_confirmed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return NextResponse.json({ purchaseId: purchase.id, status: "deposit_confirmed", sameChain: true, buyTransaction: verified.serializedTx });
    } catch (err) {
      await db.from("nft_purchases").update({ status: "failed" }).eq("id", purchase.id);
      return safeErrorResponse("nft/purchase/sui/execute", err, 502);
    }
  }

  try {
    // Cross-chain: create the actual ChangeNOW exchange now (this is the
    // side-effecting step — the quote route's estimate had none). Reuses
    // the quote-time-bound rateId (locks the exact rate quoted, valid ~10
    // min), origin_amount (the exact ETH/SOL amount that rate implies), and
    // dest_address (the Sui receiver) — all re-read from the DB row here,
    // never from client input, preserving the same MITM-prevention
    // guarantee as every other quote-bound flow in this app.
    const bridgeQuote = quote.bridge_quote as { rateId: string } | null;
    if (!bridgeQuote?.rateId) throw new Error("Quote is missing its ChangeNOW rate lock");

    const changeNowCurrency = quote.origin_chain_slug as ChangeNowOriginCurrency;
    const exchange = await createChangeNowExchange({
      fromCurrency: changeNowCurrency,
      fromAmount: quote.origin_amount,
      rateId: bridgeQuote.rateId,
      payoutAddress: quote.dest_address,
    });

    await db
      .from("nft_purchases")
      .update({ status: "deposit_pending", updated_at: new Date().toISOString() })
      .eq("id", purchase.id);
    await db
      .from("nft_purchase_quotes")
      .update({ bridge_exchange_id: exchange.id, bridge_deposit_address: exchange.depositAddress })
      .eq("id", quote.id);

    return NextResponse.json({
      purchaseId: purchase.id,
      status: "deposit_pending",
      sameChain: false,
      // A PLAIN native-ETH/SOL transfer to this address — no contract call,
      // unlike Relay/Squid's transactionRequest shape. See
      // lib/chains/changenow.ts's top comment on why this looks different.
      depositAddress: exchange.depositAddress,
      depositAmount: exchange.fromAmount,
      originCurrency: changeNowCurrency,
      originChainId: quote.origin_chain_id,
    });
  } catch (err) {
    await db.from("nft_purchases").update({ status: "failed" }).eq("id", purchase.id);
    return safeErrorResponse("nft/purchase/sui/execute", err, 502);
  }
}
