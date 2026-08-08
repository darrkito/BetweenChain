import { NextResponse } from "next/server";
import { requireSolanaSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getTriggerOrders, getRecurringOrders } from "@/lib/chains/jupiterTrigger";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 20;

/**
 * Reconciles this user's `trigger_orders` rows against Jupiter's own live
 * order status — Jupiter is the source of truth for whether/when an order
 * filled (see the trigger_orders migration's doc comment), our row only
 * carries what we knew at creation time plus the optional cross-chain
 * delivery target.
 */
export async function GET() {
  const session = await requireSolanaSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "A connected Solana wallet is required" }, { status: 401 });

  try {
    const db = supabaseAdmin();
    const { data: rows, error } = await db
      .from("trigger_orders")
      .select("*")
      .eq("user_id", session.userId)
      .is("cancelled_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const wallet = session.solanaPubkey;
    const [triggerActive, triggerHistory, recurringActive, recurringHistory] = await Promise.all([
      getTriggerOrders(wallet, "active").catch(() => []),
      getTriggerOrders(wallet, "history").catch(() => []),
      getRecurringOrders(wallet, "active").catch(() => []),
      getRecurringOrders(wallet, "history").catch(() => []),
    ]);
    const triggerStatusByKey = new Map([...triggerActive, ...triggerHistory].map((o) => [o.orderKey, o.status]));
    const recurringStatusByKey = new Map([...recurringActive, ...recurringHistory].map((o) => [o.orderKey, o.status]));

    const orders = (rows ?? []).map((row) => ({
      id: row.id,
      kind: row.kind as "limit" | "dca",
      inputSymbol: row.input_symbol,
      outputSymbol: row.output_symbol,
      outputMint: row.output_mint,
      outputDecimals: row.output_decimals,
      makingAmount: row.making_amount,
      takingAmount: row.taking_amount,
      cycleAmount: row.cycle_amount,
      cycleFrequencySeconds: row.cycle_frequency_seconds,
      destChainId: row.dest_chain_id,
      destAddress: row.dest_address,
      createdAt: row.created_at,
      jupiterStatus:
        (row.kind === "limit" ? triggerStatusByKey.get(row.jupiter_order_pubkey) : recurringStatusByKey.get(row.jupiter_order_pubkey)) ?? "unknown",
      orderPubkey: row.jupiter_order_pubkey,
    }));

    return NextResponse.json({ orders });
  } catch (err) {
    return safeErrorResponse("orders/list", err, 502);
  }
}
