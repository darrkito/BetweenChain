import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isEvmTxSuccessful } from "@/lib/chains/evm";
import { evmChainForSlug } from "@/lib/nft/evmChains";
import { creditNftPurchasePoints } from "@/lib/points";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const bodySchema = z.object({ purchaseId: z.string().uuid(), buyTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });

/**
 * Step 2 confirmation — the buyer signed and submitted the Seaport buy
 * transaction directly with their own wallet (see confirm-deposit's doc for
 * why). Verified independently via lib/chains/evm.ts's on-chain receipt
 * check before crediting anything — never trusts the client-reported hash
 * alone, same principle as every other settlement check in this codebase.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "nft:purchase:confirm-buy"), 30, 60_000);
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

  await db
    .from("nft_purchases")
    .update({ status: "buy_pending", updated_at: new Date().toISOString() })
    .eq("id", purchase.id);

  const buyChain = evmChainForSlug(purchase.nft_purchase_quotes.chain_slug);
  if (!buyChain) {
    return NextResponse.json({ error: `Unsupported EVM chain: ${purchase.nft_purchase_quotes.chain_slug}` }, { status: 400 });
  }

  let succeeded: boolean;
  try {
    succeeded = await isEvmTxSuccessful(parsed.data.buyTxHash as `0x${string}`, buyChain.chainId);
  } catch {
    // Receipt not found yet (still pending/propagating) — not a hard
    // failure, client should keep polling this same endpoint.
    return NextResponse.json({ status: "buy_pending" });
  }

  if (!succeeded) {
    await db.from("nft_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id);
    return NextResponse.json({ status: "failed" });
  }

  const nowIso = new Date().toISOString();
  await db
    .from("nft_purchases")
    .update({ status: "complete", dest_tx_hash: parsed.data.buyTxHash, dest_confirmed_at: nowIso, updated_at: nowIso })
    .eq("id", purchase.id);

  // Isolated from the "complete" status already persisted above — the buy
  // tx itself is independently verified on-chain just above, that's the
  // fact this endpoint exists to confirm. Points crediting is a best-effort
  // side effect; a failure here (DB issue, ledger constraint, etc.) must
  // never turn an already-successful purchase into an error response for
  // the buyer, same principle as app/api/swap/confirm and
  // app/api/bridge/confirm.
  try {
    const usdVolume = Number(purchase.nft_purchase_quotes.origin_amount_usd ?? 0);
    await creditNftPurchasePoints(db, { purchaseId: purchase.id, userId: session.userId, usdVolume });
  } catch (pointsErr) {
    console.error(`[nft/purchase/confirm-buy] points crediting failed for purchase ${purchase.id} (purchase itself succeeded):`, pointsErr);
  }

  return NextResponse.json({ status: "complete" });
}
