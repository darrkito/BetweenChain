import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const MIN_VOLUME_USD_FOR_POINTS = 1; // dust floor — keep test/tiny swaps out of the ledger
const REFERRER_SHARE = 0.2; // 20% of referred user's volume, as points, to the referrer
const REFERRED_BONUS = 0.1; // 10% bonus, as points, to the referred user themselves

/**
 * Credits points for a swap that has reached its final confirmed state.
 * Called only from the server-side swap/bridge confirmation path — never
 * reachable from a client-supplied value.
 *
 * SECURITY FIX (2026-08-03, live review): the idempotency guard used to be
 * check-then-act (SELECT points_credited, branch in application code, THEN
 * UPDATE) — a real, exploitable race: two near-simultaneous calls (a client
 * can trivially fire two parallel requests to the confirm route with the
 * same swapId) could both read points_credited=false before either UPDATE
 * committed, and both would credit points, doubling the payout. Fixed by
 * making the CLAIM atomic: the UPDATE itself is the guard
 * (`.eq("points_credited", false)`), and only the caller whose update
 * actually affected a row (Postgres row-level locking serializes concurrent
 * UPDATEs on the same row) proceeds to insert points_ledger rows. A losing
 * concurrent caller sees zero affected rows and returns immediately,
 * crediting nothing — genuinely idempotent under concurrency now, not just
 * under sequential retries.
 */
export async function creditSwapPoints(
  db: SupabaseClient,
  params: { swapId: string; userId: string; usdVolume: number },
): Promise<void> {
  const { swapId, userId, usdVolume } = params;
  if (usdVolume < MIN_VOLUME_USD_FOR_POINTS) return;

  const { data: claimed, error: claimErr } = await db
    .from("swap_transactions")
    .update({ points_credited: true, usd_volume: usdVolume })
    .eq("id", swapId)
    .eq("points_credited", false)
    .select("id");
  if (claimErr) throw new Error(`Failed to claim swap for points crediting: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) {
    // Zero rows affected means either (a) already credited — benign, a
    // concurrent/retried caller lost the race, return silently — or (b) the
    // swap id doesn't exist at all, which should still throw loudly rather
    // than silently swallowing a real bug. This existence check happens
    // AFTER the atomic claim attempt, purely to pick the right outcome — it
    // has no bearing on the race itself (the UPDATE above already is the
    // sole source of truth for "did I win the claim").
    const { data: exists } = await db.from("swap_transactions").select("id").eq("id", swapId).maybeSingle();
    if (!exists) throw new Error(`Swap not found: ${swapId}`);
    return;
  }

  const rows: Array<{ user_id: string; swap_id: string; points: number; reason: string }> = [
    { user_id: userId, swap_id: swapId, points: Math.floor(usdVolume), reason: "swap_volume" },
  ];

  const { data: referral } = await db
    .from("referrals")
    .select("referrer_user_id")
    .eq("referred_user_id", userId)
    .maybeSingle();

  if (referral?.referrer_user_id) {
    rows.push({
      user_id: referral.referrer_user_id,
      swap_id: swapId,
      points: usdVolume * REFERRER_SHARE,
      reason: "referral_bonus",
    });
    rows.push({
      user_id: userId,
      swap_id: swapId,
      points: usdVolume * REFERRED_BONUS,
      reason: "referred_bonus",
    });
  }

  const { error: insertErr } = await db.from("points_ledger").insert(rows);
  if (insertErr) throw new Error(`Failed to credit points: ${insertErr.message}`);
}

/**
 * Same shape as creditSwapPoints, targeting nft_purchases instead of
 * swap_transactions — kept as a separate function rather than a shared
 * helper with a table-name parameter, since Supabase's typed `.from()` calls
 * don't parameterize cleanly and the two call sites are small enough that
 * the duplication is more honest than a generic abstraction over two
 * differently-shaped tables (see the "no premature abstraction" instinct
 * already applied elsewhere in this codebase).
 */
export async function creditNftPurchasePoints(
  db: SupabaseClient,
  params: { purchaseId: string; userId: string; usdVolume: number },
): Promise<void> {
  const { purchaseId, userId, usdVolume } = params;
  if (usdVolume < MIN_VOLUME_USD_FOR_POINTS) return;

  // Atomic claim — see creditSwapPoints's doc for why this replaced a
  // check-then-act SELECT+UPDATE (a real double-credit race under
  // concurrent confirm-buy calls for the same purchaseId).
  const { data: claimed, error: claimErr } = await db
    .from("nft_purchases")
    .update({ points_credited: true, usd_volume: usdVolume })
    .eq("id", purchaseId)
    .eq("points_credited", false)
    .select("id");
  if (claimErr) throw new Error(`Failed to claim NFT purchase for points crediting: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) {
    // See creditSwapPoints's identical branch for why this distinguishes
    // "already credited" (benign) from "doesn't exist" (should throw).
    const { data: exists } = await db.from("nft_purchases").select("id").eq("id", purchaseId).maybeSingle();
    if (!exists) throw new Error(`NFT purchase not found: ${purchaseId}`);
    return;
  }

  const rows: Array<{ user_id: string; nft_purchase_id: string; points: number; reason: string }> = [
    { user_id: userId, nft_purchase_id: purchaseId, points: Math.floor(usdVolume), reason: "nft_purchase_volume" },
  ];

  const { data: referral } = await db
    .from("referrals")
    .select("referrer_user_id")
    .eq("referred_user_id", userId)
    .maybeSingle();

  if (referral?.referrer_user_id) {
    rows.push({
      user_id: referral.referrer_user_id,
      nft_purchase_id: purchaseId,
      points: usdVolume * REFERRER_SHARE,
      reason: "referral_bonus",
    });
    rows.push({
      user_id: userId,
      nft_purchase_id: purchaseId,
      points: usdVolume * REFERRED_BONUS,
      reason: "referred_bonus",
    });
  }

  const { error: insertErr } = await db.from("points_ledger").insert(rows);
  if (insertErr) throw new Error(`Failed to credit points: ${insertErr.message}`);
}
