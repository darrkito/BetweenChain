import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getRelayIntentStatus, getRelayRequestId } from "@/lib/chains/relay";
import { getOpenSeaBuyCall, OpenSeaListingUnavailableError } from "@/lib/nft/opensea";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing } from "@/lib/nft/types";

const bodySchema = z.object({ purchaseId: z.string().uuid() });

/**
 * Step 1 confirmation: verifies the origin-chain deposit against Relay's own
 * settlement status (never trusts a client-supplied tx hash — same pattern
 * as /api/bridge/confirm). Once the deposit is confirmed (ETH landed in the
 * buyer's own wallet, per migration 0006's design), this is ALSO where the
 * real listing-staleness re-check happens: a fresh getOpenSeaBuyCall call,
 * right before the buyer needs to sign step 2 — this is deliberately the
 * last possible moment, since step 1's bridging delay is the actual risk
 * window a listing could sell out during.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:confirm-deposit"), 30, 60_000);
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

  // Resumable: 'deposit_confirmed' and 'listing_gone' both re-run the fresh
  // listing check below rather than short-circuiting — harmless (always
  // gets a fresher result) and lets a client that dropped the first response
  // just retry this same call.
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

  // Fresh re-check + buy-call build — the real staleness guard.
  try {
    const listingForLookup: NftListing = {
      vendor: "opensea",
      chainFamily: "evm",
      collectionSlug: quote.collection_slug,
      tokenId: quote.token_id,
      listed: true,
      raw: { order_hash: quote.order_hash, chain: quote.chain_slug, protocol_address: quote.protocol_address },
    };
    const call = await getOpenSeaBuyCall({ listing: listingForLookup, fulfillerAddress: quote.dest_address });

    if (purchase.status === "listing_gone") {
      await db.from("nft_purchases").update({ status: "deposit_confirmed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    }

    return NextResponse.json({ status: "deposit_confirmed", buyCall: call });
  } catch (err) {
    if (err instanceof OpenSeaListingUnavailableError) {
      await db.from("nft_purchases").update({ status: "listing_gone", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      // Not a 4xx/5xx-worthy "error" from the caller's perspective — this is
      // an expected, handled outcome: the buyer's ETH already safely landed
      // in their own wallet (see migration 0006), they just don't get this
      // specific NFT. 200 with a clear status, not a thrown error.
      return NextResponse.json({ status: "listing_gone" });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
