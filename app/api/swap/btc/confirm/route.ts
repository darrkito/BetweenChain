import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getChangeNowExchangeStatus } from "@/lib/chains/changenow";
import { getSolUsdPrice, getEthUsdPrice, getBtcUsdPrice, getSuiUsdPrice } from "@/lib/pricing";
import { creditSwapPoints } from "@/lib/points";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({ swapId: z.string().uuid() });

const TERMINAL_FAILURE_STATUSES = new Set(["failed", "refunded", "expired"]);

/**
 * Polls ChangeNOW's own settlement status — never trusts a client-reported
 * result, same principle as /api/bridge/confirm's Relay intent check. Client
 * polls this repeatedly (same pattern as the Sui NFT purchase's
 * confirm-deposit route) until it returns "complete" or "leg1_failed".
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "swap:btc:confirm"), 30, 60_000);
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
  if (swap.status !== "leg1_confirmed" && swap.status !== "leg1_failed") {
    return NextResponse.json({ error: `Cannot confirm from status: ${swap.status}` }, { status: 400 });
  }
  if (!swap.changenow_exchange_id) {
    return NextResponse.json({ error: "Swap is missing its ChangeNOW exchange id" }, { status: 500 });
  }

  try {
    const exchangeStatus = await getChangeNowExchangeStatus(swap.changenow_exchange_id);

    if (TERMINAL_FAILURE_STATUSES.has(exchangeStatus.status)) {
      await db.from("swap_transactions").update({ status: "leg1_failed", updated_at: new Date().toISOString() }).eq("id", swap.id);
      return NextResponse.json({ status: "leg1_failed" });
    }
    if (exchangeStatus.status !== "finished") {
      return NextResponse.json({ status: "leg1_confirmed" }); // waiting/confirming/exchanging/sending — still settling
    }

    const nowIso = new Date().toISOString();
    await db
      .from("swap_transactions")
      .update({
        status: "complete",
        leg1_signature: exchangeStatus.payinHash ?? null,
        leg2_tx_hash: exchangeStatus.payoutHash ?? null,
        leg2_confirmed_at: nowIso,
        leg2_out_amount: swap.swap_quotes.expected_output_min,
        updated_at: nowIso,
      })
      .eq("id", swap.id);

    // Points crediting is best-effort, isolated from the "complete" status
    // already persisted above — same reasoning as /api/bridge/confirm.
    try {
      const originCurrency = swap.swap_quotes.source_chain as "btc" | "sol" | "eth" | "sui";
      const originUsdPrice =
        originCurrency === "sol"
          ? await getSolUsdPrice()
          : originCurrency === "btc"
            ? await getBtcUsdPrice()
            : originCurrency === "sui"
              ? await getSuiUsdPrice()
              : await getEthUsdPrice();
      const usdVolume = Number(swap.swap_quotes.source_amount) * originUsdPrice;

      await creditSwapPoints(db, { swapId: swap.id, userId: session.userId, usdVolume });
    } catch (pointsErr) {
      console.error(`[swap/btc/confirm] points crediting failed for swap ${swap.id} (swap itself already settled):`, pointsErr);
    }

    return NextResponse.json({ status: "complete" });
  } catch (err) {
    return safeErrorResponse("swap/btc/confirm", err, 502);
  }
}
