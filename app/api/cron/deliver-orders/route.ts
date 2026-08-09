import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deliverOrder } from "@/lib/relayer/deliverOrder";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 60;

/**
 * Vercel Cron target (see vercel.json's `crons` array) — the only place in
 * this app that acts on a user's behalf without a live request from them.
 * Authenticated by Vercel's own automatic cron header, which Vercel signs
 * with CRON_SECRET when that env var is set (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
 * — checked the same way Vercel's own docs describe, not a custom scheme.
 *
 * For every trigger_orders row that opted into automatic delivery
 * (delivery_status = 'pending'), calls deliverOrder() — which itself checks
 * the REAL on-chain delegated balance before moving anything, so this is
 * safe to run repeatedly/overlap: a row with nothing new to deliver just
 * comes back `nothing-to-deliver` and is left as-is for the next run.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const db = supabaseAdmin();
    const { data: rows, error } = await db
      .from("trigger_orders")
      .select("id, user_id, output_mint, output_decimals, dest_chain_id, dest_address, users(solana_pubkey)")
      .eq("delivery_status", "pending")
      .is("cancelled_at", null);
    if (error) throw new Error(error.message);

    const results: Array<{ id: string; status: string }> = [];
    for (const row of rows ?? []) {
      const userSolanaPubkey = (row as unknown as { users: { solana_pubkey: string | null } | null }).users?.solana_pubkey;
      if (!userSolanaPubkey || !row.dest_chain_id || !row.dest_address) continue;

      // Atomic-ish claim: flip to 'delivering' first so an overlapping cron
      // run (Vercel can retry a slow invocation) doesn't double-submit the
      // pull+deposit transactions for the same row concurrently.
      const { data: claimed } = await db
        .from("trigger_orders")
        .update({ delivery_status: "delivering" })
        .eq("id", row.id)
        .eq("delivery_status", "pending")
        .select("id")
        .single();
      if (!claimed) continue; // another run already claimed it

      const result = await deliverOrder({
        userSolanaPubkey,
        outputMint: row.output_mint,
        outputDecimals: row.output_decimals,
        destChainId: row.dest_chain_id,
        destAddress: row.dest_address,
      });

      if (result.status === "delivered") {
        await db
          .from("trigger_orders")
          .update({ delivery_status: "delivered", delivery_tx_signature: result.depositSignature })
          .eq("id", row.id);
      } else if (result.status === "failed") {
        await db.from("trigger_orders").update({ delivery_status: "failed", delivery_error: result.error }).eq("id", row.id);
      } else {
        // Nothing to deliver yet — revert the claim so the next run tries again.
        await db.from("trigger_orders").update({ delivery_status: "pending" }).eq("id", row.id);
      }
      results.push({ id: row.id, status: result.status });
    }

    return NextResponse.json({ checked: rows?.length ?? 0, results });
  } catch (err) {
    return safeErrorResponse("cron/deliver-orders", err, 500);
  }
}
