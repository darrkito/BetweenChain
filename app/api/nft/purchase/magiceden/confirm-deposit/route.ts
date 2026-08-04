import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getRelayIntentStatus, getRelayRequestId } from "@/lib/chains/relay";
import { getMagicEdenBuyInstructions } from "@/lib/nft/magiceden";
import { getSolanaBalanceLamports } from "@/lib/chains/solana";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing } from "@/lib/nft/types";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({ purchaseId: z.string().uuid() });

const SOL_NETWORK_FEE_BUFFER = 0.01; // see execute/route.ts's identical constant for why

/**
 * Step 1 confirmation for the cross-chain (ETH-origin) Magic Eden path —
 * mirrors app/api/nft/purchase/confirm-deposit/route.ts exactly, Solana
 * side: never trusts a client-reported deposit, verifies against Relay's
 * own intent status. Once the SOL has actually landed in the buyer's own
 * wallet (migration 0006's two-signature design), this is ALSO where the
 * real listing-staleness re-check + balance check happen, right before the
 * buyer needs to sign step 2 — the bridging delay is the actual risk window
 * a listing could sell out during.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:magiceden:confirm-deposit"), 30, 60_000);
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
    const requestId = getRelayRequestId(quote.relay_quote);
    if (!requestId) return NextResponse.json({ error: "No Relay request id on this purchase's quote" }, { status: 500 });

    const intentStatus = await getRelayIntentStatus(requestId);
    if (intentStatus.status === "failure" || intentStatus.status === "fallback" || intentStatus.status === "refund") {
      await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return NextResponse.json({ status: "failed" });
    }
    if (intentStatus.status !== "success") {
      return NextResponse.json({ status: "deposit_pending" }); // still settling — client should keep polling
    }

    await db
      .from("nft_purchases")
      .update({
        status: "deposit_confirmed",
        deposit_tx_hash: intentStatus.txHashes?.[0] ?? null,
        deposit_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchase.id);
  }

  // Real balance check + fresh buy-transaction build, right before step 2 —
  // the bridged amount was sized at quote time by Relay's own EXACT_OUTPUT
  // quote (should be exact), but re-verify with real on-chain balance
  // before asking for a signature, same principle as Tradeport-Sui's
  // confirm-deposit dry run.
  try {
    const requiredLamports = BigInt(Math.ceil((Number(quote.listing_price) + SOL_NETWORK_FEE_BUFFER) * 1e9));
    const balanceLamports = await getSolanaBalanceLamports(quote.dest_address);
    if (balanceLamports < requiredLamports) {
      return NextResponse.json({
        status: "insufficient_funds",
        requiredSol: (Number(requiredLamports) / 1e9).toString(),
        balanceSol: (Number(balanceLamports) / 1e9).toString(),
      });
    }

    const listing: NftListing = {
      vendor: "magiceden",
      chainFamily: "solana",
      collectionSlug: quote.collection_slug,
      tokenId: quote.token_id,
      listed: true,
      raw: quote.magiceden_listing,
    };
    const buyTx = await getMagicEdenBuyInstructions({ buyer: quote.dest_address, listing });

    if (purchase.status === "listing_gone") {
      await db.from("nft_purchases").update({ status: "deposit_confirmed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    }

    return NextResponse.json({ status: "deposit_confirmed", buyTransaction: buyTx });
  } catch (err) {
    // Magic Eden's buy_now has no separate "is this listing still valid"
    // check distinct from actually building the buy transaction — a sold/
    // delisted/cancelled listing surfaces as a thrown error here, same as
    // it would at quote time. Not a hard failure: the buyer's SOL already
    // safely landed in their own wallet (migration 0006's whole point) —
    // they just don't get this specific NFT.
    await db.from("nft_purchases").update({ status: "listing_gone", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    return NextResponse.json({ status: "listing_gone", detail: (err as Error).message });
  }
}
