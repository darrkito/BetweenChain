import { NextResponse } from "next/server";
import { requireSolanaSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cancelTriggerOrder, cancelRecurringOrder } from "@/lib/chains/jupiterTrigger";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 20;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSolanaSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "A connected Solana wallet is required" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "orders:cancel"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id } = await ctx.params;

  try {
    const db = supabaseAdmin();
    // Row must belong to this user — never trust a client-supplied
    // order/wallet pair without this check (same "creator/owner scoping"
    // rule as every other user-owned row in this app).
    const { data: row, error } = await db.from("trigger_orders").select("*").eq("id", id).eq("user_id", session.userId).single();
    if (error || !row) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const wallet = session.solanaPubkey;
    const unsigned =
      row.kind === "limit"
        ? await cancelTriggerOrder({ wallet, order: row.jupiter_order_pubkey })
        : await cancelRecurringOrder({ wallet, order: row.jupiter_order_pubkey });

    return NextResponse.json({ transaction: unsigned.transaction });
  } catch (err) {
    return safeErrorResponse("orders/cancel", err, 502);
  }
}

/**
 * Marks the order cancelled in our own cache once the client has confirmed
 * the cancel transaction on-chain — separate from the POST above (which
 * only builds the unsigned tx) so a cancel that's signed but never
 * submitted/confirmed doesn't silently hide a still-active order from the
 * user's list.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSolanaSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "A connected Solana wallet is required" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    const db = supabaseAdmin();
    const { error } = await db
      .from("trigger_orders")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", session.userId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse("orders/cancel-confirm", err, 502);
  }
}
