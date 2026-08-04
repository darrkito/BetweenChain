import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getChangeNowExchangeStatus } from "@/lib/chains/changenow";
import { isTradeportListingStillActive, type TradeportChain } from "@/lib/nft/tradeport";
import { buildVerifiedTradeportBuyTransaction } from "@/lib/nft/tradeportBuy";
import { TRADEPORT_FEE_SAFETY_MARGIN } from "@/lib/chains/sui";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Unlike Squid's status API (which needed the client-reported origin tx
// hash to look anything up), ChangeNOW's exchange id is already known
// server-side from the execute step (nft_purchase_quotes.bridge_exchange_id)
// — no client-supplied identifier needed here at all, just the purchase id.
const bodySchema = z.object({ purchaseId: z.string().uuid() });

const TERMINAL_FAILURE_STATUSES = new Set(["failed", "refunded", "expired"]);

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:sui:confirm-deposit"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: purchase, error: purchaseErr } = await db
    .from("nft_purchases")
    .select("*, nft_purchase_quotes(*)")
    .eq("id", parsed.data.purchaseId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (purchaseErr || !purchase) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });

  const quote = purchase.nft_purchase_quotes;

  if (!["deposit_pending", "deposit_confirmed", "listing_gone"].includes(purchase.status)) {
    return NextResponse.json({ error: `Cannot confirm deposit from status: ${purchase.status}` }, { status: 400 });
  }

  if (purchase.status === "deposit_pending") {
    if (!quote.bridge_exchange_id) throw new Error("Purchase is missing its ChangeNOW exchange id");
    const exchangeStatus = await getChangeNowExchangeStatus(quote.bridge_exchange_id);

    if (TERMINAL_FAILURE_STATUSES.has(exchangeStatus.status)) {
      await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return NextResponse.json({ status: "failed" });
    }
    if (exchangeStatus.status !== "finished") {
      return NextResponse.json({ status: "deposit_pending" }); // waiting/confirming/exchanging/sending — still settling
    }

    await db
      .from("nft_purchases")
      .update({
        status: "deposit_confirmed",
        deposit_tx_hash: exchangeStatus.payinHash ?? null,
        deposit_confirmed_at: new Date().toISOString(),
        dest_tx_hash: exchangeStatus.payoutHash ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchase.id);
  }

  // Fresh staleness re-check + buy-transaction build, right before the
  // buyer signs step 2 — same reasoning as OpenSea's confirm-deposit: the
  // bridging delay is the real window a listing could sell out during.
  try {
    const stillActive = await isTradeportListingStillActive(quote.move_chain as TradeportChain, quote.tradeport_listing_id);
    if (!stillActive) {
      await db.from("nft_purchases").update({ status: "listing_gone", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return NextResponse.json({ status: "listing_gone" });
    }

    // Real dry-run cost + real balance check — the CRITICAL fix (see
    // lib/chains/sui.ts's doc). The bridged amount was sized at quote time
    // with a safety margin over listing price (TRADEPORT_FEE_SAFETY_MARGIN),
    // but that was an estimate before real funds existed — now that the
    // bridge has actually delivered SUI, verify it was really enough before
    // asking for a signature, instead of letting it silently draw from
    // unrelated existing balance if it wasn't.
    const verified = await buildVerifiedTradeportBuyTransaction({
      listingId: quote.tradeport_listing_id,
      walletAddress: quote.dest_address,
    });

    if (purchase.status === "listing_gone") {
      await db.from("nft_purchases").update({ status: "deposit_confirmed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    }

    if (!verified.sufficient) {
      await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      // costMist is null when the dry run failed outright (severely
      // underfunded) rather than succeeding with a known exact cost —
      // fall back to the same listing-price + safety-margin estimate the
      // quote route used, clearly an estimate rather than an exact figure.
      const requiredSui =
        verified.costMist != null ? Number(verified.costMist) / 1e9 : Number(quote.listing_price) * (1 + TRADEPORT_FEE_SAFETY_MARGIN);
      return NextResponse.json({
        status: "insufficient_funds",
        requiredSui: requiredSui.toString(),
        balanceSui: (Number(verified.balanceMist) / 1e9).toString(),
      });
    }

    return NextResponse.json({ status: "deposit_confirmed", buyTransaction: verified.serializedTx });
  } catch (err) {
    return safeErrorResponse("nft/purchase/sui/confirm-deposit", err, 502);
  }
}
