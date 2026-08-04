import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { verifySuiBuyTx } from "@/lib/chains/sui";
import { creditNftPurchasePoints } from "@/lib/points";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// Sui transaction digests are base58, not the 0x-hex EVM shape — 32 raw
// bytes base58-encoded, roughly 43-44 characters, confirmed against
// @mysten/sui's own digest examples.
const bodySchema = z.object({ purchaseId: z.string().uuid(), buyTxDigest: z.string().min(32).max(50) });

/**
 * Step 2 confirmation — mirrors the OpenSea confirm-buy route exactly, Sui
 * side: never trusts the client-reported digest alone, independently
 * verifies against a real Sui RPC (lib/chains/sui.ts) before crediting
 * anything. (2026-08-04, real fraud bug fix) verifies the buyer's own
 * wallet signed the tx and its balance actually decreased by the listing
 * price, not just that some tx succeeded — see lib/chains/sui.ts's
 * verifySuiBuyTx.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:sui:confirm-buy"), 30, 60_000);
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
  // this tx and its SUI balance decreased by at least the listing price —
  // not just that some tx succeeded. See lib/chains/evm.ts's verifyEvmBuyTx
  // doc comment for the full exploit this class of fix closes, and
  // lib/chains/sui.ts's verifySuiBuyTx for the Sui-specific balance-delta
  // verification (same balanceChanges shape already proven live in
  // dryRunSuiTransactionCostMist).
  const minMistSpent = BigInt(Math.floor(Number(purchase.nft_purchase_quotes.listing_price) * 1e9));

  let succeeded: boolean;
  try {
    succeeded = await verifySuiBuyTx({
      digest: parsed.data.buyTxDigest,
      expectedSigner: purchase.nft_purchase_quotes.dest_address,
      minMistSpent,
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
    .update({ status: "complete", dest_tx_hash: parsed.data.buyTxDigest, dest_confirmed_at: nowIso, updated_at: nowIso })
    .eq("id", purchase.id);

  // Isolated from the "complete" status already persisted above — see
  // app/api/nft/purchase/confirm-buy/route.ts's identical comment (this is
  // the Sui mirror of that same fix).
  try {
    const usdVolume = Number(purchase.nft_purchase_quotes.origin_amount_usd ?? 0);
    await creditNftPurchasePoints(db, { purchaseId: purchase.id, userId: session.userId, usdVolume });
  } catch (pointsErr) {
    console.error(`[nft/purchase/sui/confirm-buy] points crediting failed for purchase ${purchase.id} (purchase itself succeeded):`, pointsErr);
  }

  return NextResponse.json({ status: "complete" });
}
