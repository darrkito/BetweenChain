import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildJupiterSwapTransaction } from "@/lib/chains/jupiter";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

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
  // done otherwise. Checking `jupiter_route == null` directly (2026-08-07,
  // real bug fix) rather than re-deriving "was a Jupiter leg needed" from
  // `source_mint === NATIVE_SOL_MINT` — that re-derivation was WRONG once
  // same-chain Solana could target an arbitrary SPL mint: a native-SOL
  // source swapping INTO an SPL token (e.g. SOL -> BONK) genuinely DOES
  // need a real Jupiter leg despite the source being SOL, but the old check
  // would have silently skipped building any Jupiter transaction at all and
  // reported leg 1 "confirmed" with the wrong output amount
  // (source_amount, i.e. the SOL amount, not the SPL amount actually
  // owed). `jupiter_route` is set by /api/quote iff a real Jupiter quote
  // was actually fetched for this exact quote — the single source of truth
  // for whether a Jupiter transaction needs to exist, not a re-derived
  // approximation of it.
  if (quote.jupiter_route == null) {
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
    return safeErrorResponse("swap", err, 502);
  }
}
