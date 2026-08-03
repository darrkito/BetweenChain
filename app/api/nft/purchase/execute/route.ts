import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildRelayExecutionSteps } from "@/lib/chains/relay";
import { getOpenSeaBuyCall, OpenSeaListingUnavailableError } from "@/lib/nft/opensea";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing } from "@/lib/nft/types";

const bodySchema = z.object({ quoteId: z.string().uuid() });

// Consumes an nft_purchase_quotes row. Two shapes, branching on whether the
// quote has a Relay leg at all (see app/api/nft/purchase/quote/route.ts's
// same-chain handling, added 2026-07-21):
// - Cross-chain: returns the step-1 (deposit) transaction to sign — no
//   Jupiter-style intermediate leg here (unlike /api/swap), the NFT quote's
//   Relay leg is the entire step 1 by definition.
// - Same-chain: no deposit exists at all — the buyer already holds the
//   funds. Skips straight to a fresh buy-call build (same staleness
//   re-check /api/nft/purchase/confirm-deposit does for the cross-chain
//   case) and returns it directly for one signature.
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:execute"), 20, 60_000);
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
    .is("consumed_at", null); // race guard: only succeeds for the first caller
  if (consumeErr) return NextResponse.json({ error: "Failed to consume quote" }, { status: 500 });

  const { data: purchase, error: insertErr } = await db
    .from("nft_purchases")
    .insert({ quote_id: quote.id, user_id: session.userId, status: "pending" })
    .select("id")
    .single();
  if (insertErr || !purchase) return NextResponse.json({ error: "Failed to create NFT purchase" }, { status: 500 });

  if (!quote.relay_quote) {
    // Same-chain path.
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
      await db.from("nft_purchases").update({ status: "deposit_confirmed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return NextResponse.json({ purchaseId: purchase.id, status: "deposit_confirmed", sameChain: true, buyCall: call });
    } catch (err) {
      if (err instanceof OpenSeaListingUnavailableError) {
        await db.from("nft_purchases").update({ status: "listing_gone", updated_at: new Date().toISOString() }).eq("id", purchase.id);
        return NextResponse.json({ purchaseId: purchase.id, status: "listing_gone" });
      }
      await db.from("nft_purchases").update({ status: "failed" }).eq("id", purchase.id);
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
  }

  try {
    const steps = await buildRelayExecutionSteps(quote.relay_quote);
    await db.from("nft_purchases").update({ status: "deposit_pending", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    return NextResponse.json({ purchaseId: purchase.id, status: "deposit_pending", sameChain: false, steps });
  } catch (err) {
    await db.from("nft_purchases").update({ status: "failed" }).eq("id", purchase.id);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
