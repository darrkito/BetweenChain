import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getRelayIntentStatus, getRelayRequestId } from "@/lib/chains/relay";
import { getSolUsdPrice, lamportsToUsd } from "@/lib/pricing";
import { creditSwapPoints } from "@/lib/points";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({ swapId: z.string().uuid() });

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "bridge:confirm"), 30, 60_000);
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
  if (swap.status === "complete") return NextResponse.json({ status: "complete" }); // idempotent
  if (swap.status !== "leg2_pending") {
    return NextResponse.json({ error: `Cannot confirm from status: ${swap.status}` }, { status: 400 });
  }

  // Verified server-side against Relay's own settlement status — not
  // trusted from the client. This closes the gap flagged in SECURITY.md: a
  // malicious client could previously report an inflated destOutAmount to
  // farm extra points; now the destination tx hash comes from Relay itself,
  // and points are only credited once Relay confirms "success".
  const requestId = getRelayRequestId(swap.swap_quotes.relay_route);
  if (!requestId) {
    return NextResponse.json({ error: "No Relay request id on this swap's quote" }, { status: 500 });
  }

  const intentStatus = await getRelayIntentStatus(requestId);

  // Stall Transparency Panel (2026-08-09) — `relayStatus` is Relay's own
  // real intent status (pending/success/failure/fallback/received/refund/
  // unknown), previously swallowed into a 3-way collapse that made a
  // `refund` (funds actively being RETURNED) indistinguishable from
  // ordinary "still settling" — a real user-facing gap: someone watching a
  // generic spinner during an active refund has no idea their money is
  // coming back, not stuck. `refund`/`failure`/`fallback` all end this
  // leg's polling immediately rather than waiting out the full retry
  // budget for an outcome that's already known.
  if (intentStatus.status === "failure" || intentStatus.status === "fallback" || intentStatus.status === "refund") {
    await db.from("swap_transactions").update({ status: "leg2_failed" }).eq("id", swap.id);
    return NextResponse.json({ status: "leg2_failed", relayStatus: intentStatus.status });
  }
  if (intentStatus.status !== "success") {
    return NextResponse.json({ status: "leg2_pending", relayStatus: intentStatus.status }); // still settling — client should keep polling
  }

  const nowIso = new Date().toISOString();
  await db
    .from("swap_transactions")
    .update({
      status: "complete",
      leg2_tx_hash: intentStatus.txHashes?.[0] ?? null,
      leg2_confirmed_at: nowIso,
      // Relay's status API doesn't report the exact delivered amount (only
      // tx hashes) — the originally quoted expected amount is the best
      // available figure here. Noted as a known approximation, not silently
      // assumed precise.
      leg2_out_amount: swap.swap_quotes.expected_output_min,
      updated_at: nowIso,
    })
    .eq("id", swap.id);

  // Points crediting is a best-effort side effect, isolated from the
  // "complete" status already persisted above — the destination settlement
  // is independently verified via Relay's own status API just above, that's
  // the fact this endpoint exists to confirm. For Solana-origin swaps, the
  // USD figure depends on an external price feed (Jupiter's price/v3 —
  // already silently retired once before, see lib/pricing.ts's
  // getSolUsdPrice comment); a transient failure there must never turn an
  // already-successfully-settled swap into an error response for the user.
  // Non-Solana origins don't call getSolUsdPrice at all (they reuse Relay's
  // own quote-time USD valuation, see the comment below), so this only
  // guards the Solana-origin path in practice, but both go through the same
  // try/catch for one consistent, easy-to-reason-about code path.
  try {
    // USD volume for points: Solana-origin swaps price off leg1's SOL output
    // (existing behavior). Non-Solana origins never touch SOL at all — leg1_out_amount
    // there is raw origin-token units (USDC atomic units, wei, ...), which
    // lamportsToUsd() would misinterpret entirely. Relay's own quote response
    // (stored verbatim in relay_route) already includes a USD valuation of the
    // origin amount at quote time — reuse that instead of a separate price lookup.
    // See STATE.md 2026-07-18i.
    const usdVolume =
      swap.swap_quotes.source_chain === "solana"
        ? lamportsToUsd(swap.leg1_out_amount ?? 0, await getSolUsdPrice())
        : Number(swap.swap_quotes.relay_route?.details?.currencyIn?.amountUsd ?? 0);

    await creditSwapPoints(db, {
      swapId: swap.id,
      userId: session.userId,
      usdVolume,
    });
  } catch (pointsErr) {
    console.error(`[bridge/confirm] points crediting failed for swap ${swap.id} (swap itself already settled):`, pointsErr);
  }

  return NextResponse.json({ status: "complete" });
}
