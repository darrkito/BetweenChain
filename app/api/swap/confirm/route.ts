import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getConnection } from "@/lib/solana";
import { getSolUsdPrice, lamportsToUsd } from "@/lib/pricing";
import { creditSwapPoints } from "@/lib/points";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const bodySchema = z.object({
  swapId: z.string().uuid(),
  signature: z.string().min(1), // base58 tx signature the client just submitted
});

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "swap:confirm"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: swap, error: swapErr } = await db
    .from("swap_transactions")
    .select("*, swap_quotes(*)")
    .eq("id", parsed.data.swapId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (swapErr || !swap) return NextResponse.json({ error: "Swap not found" }, { status: 404 });
  if (swap.status !== "leg1_pending") {
    return NextResponse.json({ status: swap.status }); // idempotent: already resolved
  }
  // Reaching leg1_pending at all means /api/swap already required a real
  // Solana signer to build the Jupiter transaction being confirmed here —
  // this should be unreachable for an EVM-only session, but guard anyway
  // rather than indexing accountKeys with `null`.
  if (!session.solanaPubkey) {
    return NextResponse.json({ error: "This action requires a Solana wallet." }, { status: 400 });
  }

  try {
    const connection = getConnection();
    const result = await connection.confirmTransaction(parsed.data.signature, "confirmed");
    if (result.value.err) {
      await db.from("swap_transactions").update({ status: "leg1_failed" }).eq("id", swap.id);
      return NextResponse.json({ error: "Transaction failed on-chain" }, { status: 400 });
    }

    const tx = await connection.getParsedTransaction(parsed.data.signature, {
      maxSupportedTransactionVersion: 0,
    });
    const accountKeys = tx?.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()) ?? [];
    const userIdx = accountKeys.indexOf(session.solanaPubkey);
    const solOut =
      userIdx >= 0 && tx?.meta
        ? tx.meta.postBalances[userIdx] - tx.meta.preBalances[userIdx] + (tx.meta.fee ?? 0)
        : Number(swap.swap_quotes.expected_output_min ?? 0);

    const nowIso = new Date().toISOString();
    const isSameChain = swap.swap_quotes.dest_chain === "solana";

    await db
      .from("swap_transactions")
      .update({
        status: "leg1_confirmed",
        leg1_signature: parsed.data.signature,
        leg1_confirmed_at: nowIso,
        leg1_out_amount: solOut,
        updated_at: nowIso,
      })
      .eq("id", swap.id);

    // Same-chain swaps end here — no bridge leg needed. The on-chain swap
    // itself already succeeded (verified above via getParsedTransaction) —
    // that's the fact this endpoint exists to confirm, and "complete" must
    // reflect it regardless of what happens next. Points crediting is a
    // best-effort side effect that depends on an external price feed
    // (Jupiter's price/v3 — already silently retired once before, see
    // lib/pricing.ts's getSolUsdPrice comment); isolated in its own
    // try/catch so a transient price-feed failure can never (a) leave this
    // swap stuck reporting something other than "complete" despite having
    // genuinely succeeded on-chain, or (b) turn an already-successful swap
    // into a 502 error for the user. A failure here is logged loudly and
    // the points simply don't get credited for this swap — better than
    // corrupting the swap's own status over a secondary side effect.
    if (isSameChain) {
      await db.from("swap_transactions").update({ status: "complete" }).eq("id", swap.id);
      try {
        const solUsdPrice = await getSolUsdPrice();
        await creditSwapPoints(db, {
          swapId: swap.id,
          userId: session.userId,
          usdVolume: lamportsToUsd(solOut, solUsdPrice),
        });
      } catch (pointsErr) {
        console.error(`[swap/confirm] points crediting failed for swap ${swap.id} (swap itself succeeded):`, pointsErr);
      }
      return NextResponse.json({ status: "complete" });
    }

    return NextResponse.json({ status: "leg1_confirmed" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
