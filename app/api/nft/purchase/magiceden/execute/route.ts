import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getMagicEdenBuyInstructions } from "@/lib/nft/magiceden";
import { buildRelayExecutionSteps } from "@/lib/chains/relay";
import { getSolanaBalanceLamports } from "@/lib/chains/solana";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import type { NftListing } from "@/lib/nft/types";

const bodySchema = z.object({ quoteId: z.string().uuid() });

// Flat SOL buffer on top of the listing price for same-chain purchases —
// covers the transaction fee and, if the buyer doesn't already have one, a
// fresh associated-token-account rent-exempt deposit for the incoming NFT.
// Magic Eden's buy_now response embeds the REAL exact charge (no separate
// dry-run/cost-preview endpoint exists, unlike Tradeport's), so this is a
// balance-sufficiency floor, not the amount actually signed — same spirit
// as TRADEPORT_FEE_SAFETY_MARGIN but sized for Solana's much smaller,
// flatter fee structure instead of a percentage.
const SOL_NETWORK_FEE_BUFFER = 0.01;

/**
 * Consumes an nft_purchase_quotes row (vendor='magiceden'). Mirrors
 * app/api/nft/purchase/sui/execute/route.ts's same-chain/cross-chain
 * branch, keyed on whether the quote has a Relay leg:
 * - Same-chain (relay_quote null): no deposit — the buyer's own Solana
 *   wallet already holds the funds. Real balance check, then a FRESH
 *   getMagicEdenBuyInstructions call (never reuse the quote-time one) for
 *   one signature.
 * - Cross-chain: returns the step-1 (ETH deposit) transaction to sign, via
 *   the same buildRelayExecutionSteps path the token-swap flow already uses
 *   for EVM origins.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:magiceden:execute"), 20, 60_000);
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

  if (!quote.relay_quote) {
    // Same-chain path.
    try {
      const requiredLamports = BigInt(Math.ceil((Number(quote.listing_price) + SOL_NETWORK_FEE_BUFFER) * 1e9));
      const balanceLamports = await getSolanaBalanceLamports(quote.dest_address);
      if (balanceLamports < requiredLamports) {
        await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
        return NextResponse.json({
          purchaseId: purchase.id,
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
      await db.from("nft_purchases").update({ status: "deposit_confirmed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
      return NextResponse.json({ purchaseId: purchase.id, status: "deposit_confirmed", sameChain: true, buyTransaction: buyTx });
    } catch (err) {
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
