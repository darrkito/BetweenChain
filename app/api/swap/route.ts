import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildJupiterSwapTransaction, NATIVE_SOL_MINT } from "@/lib/chains/jupiter";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const bodySchema = z.object({ quoteId: z.string().uuid() });

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "swap"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();

  // Fetch + atomically consume the quote in one step: single-use, and scoped
  // to this session's user so a stolen quoteId from another user is useless.
  const { data: quote, error: quoteErr } = await db
    .from("swap_quotes")
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
    .from("swap_quotes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", quote.id)
    .is("consumed_at", null); // race guard: only succeeds for the first caller
  if (consumeErr) {
    return NextResponse.json({ error: "Failed to consume quote" }, { status: 500 });
  }

  const { data: swapTx, error: insertErr } = await db
    .from("swap_transactions")
    .insert({ quote_id: quote.id, user_id: session.userId, status: "leg1_pending" })
    .select("id")
    .single();
  if (insertErr || !swapTx) {
    return NextResponse.json({ error: "Failed to create swap transaction" }, { status: 500 });
  }

  // Nothing for Jupiter to do — leg 1 is trivially "confirmed" and the
  // caller should go straight to /api/bridge (if cross-chain) or is already
  // done otherwise. Two cases hit this: same-chain Solana source is already
  // SOL (original case), or the source chain isn't Solana at all — Jupiter
  // only ever operates on Solana, so a non-Solana origin has no leg 1
  // conversion step by definition; Relay is the whole execution engine for
  // that case (see AGENTS.md / STATE.md 2026-07-18i).
  if (quote.source_mint === NATIVE_SOL_MINT || quote.source_chain !== "solana") {
    await db
      .from("swap_transactions")
      .update({ status: "leg1_confirmed", leg1_out_amount: quote.source_amount, leg1_confirmed_at: new Date().toISOString() })
      .eq("id", swapTx.id);
    return NextResponse.json({ swapId: swapTx.id, status: "leg1_confirmed", unsignedTransaction: null });
  }

  if (!session.solanaPubkey) {
    // Reached only for a Solana-origin, non-native-SOL quote — building the
    // Jupiter leg 1 transaction requires a real Solana signer. An EVM-only
    // session (migration 0008_evm_standalone_signin.sql) can't have created
    // this kind of quote in the first place via the UI, but guard here too
    // rather than passing `null` as a pubkey.
    await db.from("swap_transactions").update({ status: "leg1_failed" }).eq("id", swapTx.id);
    return NextResponse.json({ error: "This action requires a Solana wallet — sign in with Solana to continue." }, { status: 400 });
  }

  try {
    const { swapTransaction } = await buildJupiterSwapTransaction({
      route: quote.jupiter_route,
      userPublicKey: session.solanaPubkey,
    });
    return NextResponse.json({ swapId: swapTx.id, status: "leg1_pending", unsignedTransaction: swapTransaction });
  } catch (err) {
    await db.from("swap_transactions").update({ status: "leg1_failed" }).eq("id", swapTx.id);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
