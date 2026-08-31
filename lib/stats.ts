import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cached } from "@/lib/cache";

// Extracted from app/api/stats/route.ts (2026-08-25, agent-discoverability
// pass) so the MCP `get_platform_stats` tool can call the exact same real
// aggregate the public REST route already serves, instead of either
// duplicating this query or doing an internal HTTP round-trip to the app's
// own API. Sums `usd_volume` on `complete`-status rows only — same
// completion definition lib/points.ts already uses to credit points.
async function computePlatformStats() {
  const db = supabaseAdmin();
  const [swaps, nfts, triggerOrders, dustSweeps] = await Promise.all([
    db.from("swap_transactions").select("usd_volume", { count: "exact" }).eq("status", "complete"),
    db.from("nft_purchases").select("usd_volume", { count: "exact" }).eq("status", "complete"),
    // Trigger orders (limit/DCA, app/orders) and dust-sweeper deliveries are
    // real completed on-chain swaps too (see
    // app/api/cron/deliver-orders/route.ts) but land in their own tables
    // under `delivery_status`, not `swap_transactions` — the count here was
    // silently excluding both, undercounting the home page's "completed
    // transactions" number. Count-only (head: true, no rows fetched):
    // neither table captures a usd_volume at fill time (only raw atomic
    // token amounts), so totalUsdVolume intentionally stays swap+NFT only
    // until that's captured — see stats.ts git history / PR discussion for
    // that follow-up.
    db.from("trigger_orders").select("*", { count: "exact", head: true }).eq("delivery_status", "delivered"),
    db.from("dust_sweep_authorizations").select("*", { count: "exact", head: true }).eq("delivery_status", "delivered"),
  ]);

  const swapVolume = (swaps.data ?? []).reduce((sum, r) => sum + (r.usd_volume ?? 0), 0);
  const nftVolume = (nfts.data ?? []).reduce((sum, r) => sum + (r.usd_volume ?? 0), 0);

  return {
    totalTransactions: (swaps.count ?? 0) + (nfts.count ?? 0) + (triggerOrders.count ?? 0) + (dustSweeps.count ?? 0),
    totalUsdVolume: Math.round(swapVolume + nftVolume),
  };
}

export async function getPlatformStats() {
  return cached("stats:platform", 5 * 60_000, computePlatformStats);
}
