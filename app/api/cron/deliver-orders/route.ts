import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deliverOrder } from "@/lib/relayer/deliverOrder";
import { deliverDustSweep } from "@/lib/relayer/deliverDustSweep";
import { safeErrorResponse } from "@/lib/apiError";
import { sendPushToUser } from "@/lib/push";

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
 *
 * ALSO processes dust_sweep_authorizations (OmniDust Vacuum, 2026-08-09) —
 * deliberately kept in this SAME cron route rather than a second `crons`
 * entry, since Vercel's Hobby plan rejected this project's deployment
 * outright the first time a second/sub-daily cron was attempted (see
 * STATE.md's 2026-08-09 entry) — one daily cron scanning multiple pending
 * queues is the safe pattern on this plan.
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
        // Best-effort — a push failure must never affect the real delivery
        // that already succeeded above. No-ops entirely if the user never
        // subscribed or push isn't configured (see lib/push.ts).
        await sendPushToUser(row.user_id, {
          title: "Trigger Order filled",
          body: "Your order was delivered — check /orders for details.",
          url: "/orders",
        }).catch(() => {});
      } else if (result.status === "failed") {
        await db.from("trigger_orders").update({ delivery_status: "failed", delivery_error: result.error }).eq("id", row.id);
      } else {
        // Nothing to deliver yet — revert the claim so the next run tries again.
        await db.from("trigger_orders").update({ delivery_status: "pending" }).eq("id", row.id);
      }
      results.push({ id: row.id, status: result.status });
    }

    const { data: dustRows, error: dustError } = await db
      .from("dust_sweep_authorizations")
      .select("id, user_id, token_mint, token_decimals, users(solana_pubkey)")
      .eq("delivery_status", "pending")
      .is("cancelled_at", null);
    if (dustError) throw new Error(dustError.message);

    const dustResults: Array<{ id: string; status: string }> = [];
    for (const row of dustRows ?? []) {
      const userSolanaPubkey = (row as unknown as { users: { solana_pubkey: string | null } | null }).users?.solana_pubkey;
      if (!userSolanaPubkey) continue;

      const { data: claimed } = await db
        .from("dust_sweep_authorizations")
        .update({ delivery_status: "delivering" })
        .eq("id", row.id)
        .eq("delivery_status", "pending")
        .select("id")
        .single();
      if (!claimed) continue;

      const result = await deliverDustSweep({ userSolanaPubkey, tokenMint: row.token_mint, tokenDecimals: row.token_decimals });

      if (result.status === "delivered") {
        await db
          .from("dust_sweep_authorizations")
          .update({ delivery_status: "delivered", delivery_tx_signature: result.sendSignature })
          .eq("id", row.id);
      } else if (result.status === "failed") {
        await db.from("dust_sweep_authorizations").update({ delivery_status: "failed", delivery_error: result.error }).eq("id", row.id);
      } else {
        await db.from("dust_sweep_authorizations").update({ delivery_status: "pending" }).eq("id", row.id);
      }
      dustResults.push({ id: row.id, status: result.status });
    }

    return NextResponse.json({ checked: rows?.length ?? 0, results, dustChecked: dustRows?.length ?? 0, dustResults });
  } catch (err) {
    return safeErrorResponse("cron/deliver-orders", err, 500);
  }
}
