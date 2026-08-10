import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cached } from "@/lib/cache";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Real platform-wide stats (2026-08-10 UX-audit follow-up, Part 1 priority
// #3 — "yes to real numbers, explicit no to the audit's suggestion of
// 'audit badges'"). Sums `usd_volume` on `complete`-status rows only —
// same completion definition `lib/points.ts` already uses to credit points,
// so this can never show a number the user's own dashboard balance
// disagrees with. Public, unauthenticated (this is a platform aggregate,
// not per-user data) — cached 5min via the shared Redis cache since this
// hits two full-table aggregates and traffic doesn't need second-by-second
// freshness for a trust-signal counter.
async function getRealStats() {
  const db = supabaseAdmin();
  const [swaps, nfts] = await Promise.all([
    db.from("swap_transactions").select("usd_volume", { count: "exact" }).eq("status", "complete"),
    db.from("nft_purchases").select("usd_volume", { count: "exact" }).eq("status", "complete"),
  ]);

  const swapVolume = (swaps.data ?? []).reduce((sum, r) => sum + (r.usd_volume ?? 0), 0);
  const nftVolume = (nfts.data ?? []).reduce((sum, r) => sum + (r.usd_volume ?? 0), 0);

  return {
    totalTransactions: (swaps.count ?? 0) + (nfts.count ?? 0),
    totalUsdVolume: Math.round(swapVolume + nftVolume),
  };
}

export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "stats"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const stats = await cached("stats:platform", 5 * 60_000, getRealStats);
    return NextResponse.json(stats);
  } catch (e) {
    return safeErrorResponse("stats", e, 502);
  }
}
