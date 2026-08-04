import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifySolanaBuyTx } from "@/lib/chains/solana";
import { creditNftPurchasePoints } from "@/lib/points";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// Solana signatures are base58, ~87-88 characters (64 raw bytes).
const bodySchema = z.object({ purchaseId: z.string().uuid(), buyTxSignature: z.string().min(64).max(96) });

/**
 * Step 2 confirmation — mirrors app/api/nft/purchase/sui/confirm-buy/route.ts
 * exactly, Solana side: never trusts the client-reported signature alone,
 * independently verifies against a real Solana RPC before crediting
 * anything. (2026-08-04, real fraud bug fix) verifies the buyer's own
 * wallet signed the tx and its balance actually decreased by the listing
 * price, not just that some tx succeeded — see lib/chains/solana.ts's
 * verifySolanaBuyTx.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:magiceden:confirm-buy"), 30, 60_000);
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
  if (purchase.status === "complete") return NextResponse.json({ status: "complete" }); // idempotent
  if (!["deposit_confirmed", "buy_pending"].includes(purchase.status)) {
    return NextResponse.json({ error: `Cannot confirm buy from status: ${purchase.status}` }, { status: 400 });
  }

  await db.from("nft_purchases").update({ status: "buy_pending", updated_at: new Date().toISOString() }).eq("id", purchase.id);

  // SECURITY FIX 2026-08-04: verify the buyer's own wallet actually signed
  // this tx and its SOL balance decreased by at least the listing price —
  // not just that some tx succeeded. See lib/chains/evm.ts's verifyEvmBuyTx
  // doc comment for the full exploit this class of fix closes (Solana has
  // no fixed "to" contract to check the way Seaport does, so this verifies
  // the same intent — the buyer paid the real price — via balance deltas
  // instead, see lib/chains/solana.ts's verifySolanaBuyTx).
  const minLamportsSpent = BigInt(Math.floor(Number(purchase.nft_purchase_quotes.listing_price) * 1e9));

  let succeeded: boolean;
  try {
    succeeded = await verifySolanaBuyTx({
      signature: parsed.data.buyTxSignature,
      expectedSigner: purchase.nft_purchase_quotes.dest_address,
      minLamportsSpent,
    });
  } catch {
    // Not found yet (still propagating) — not a hard failure, client should
    // keep polling this same endpoint.
    return NextResponse.json({ status: "buy_pending" });
  }

  if (!succeeded) {
    await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    return NextResponse.json({ status: "failed" });
  }

  const nowIso = new Date().toISOString();
  await db
    .from("nft_purchases")
    .update({ status: "complete", dest_tx_hash: parsed.data.buyTxSignature, dest_confirmed_at: nowIso, updated_at: nowIso })
    .eq("id", purchase.id);

  // Isolated from the "complete" status already persisted above — same
  // pattern as every other confirm-buy route (a points-crediting failure
  // must never roll back or mask a purchase that actually succeeded).
  try {
    const usdVolume = Number(purchase.nft_purchase_quotes.origin_amount_usd ?? 0);
    await creditNftPurchasePoints(db, { purchaseId: purchase.id, userId: session.userId, usdVolume });
  } catch (pointsErr) {
    console.error(
      `[nft/purchase/magiceden/confirm-buy] points crediting failed for purchase ${purchase.id} (purchase itself succeeded):`,
      pointsErr,
    );
  }

  return NextResponse.json({ status: "complete" });
}
