import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const MIN_VOLUME_USD_FOR_POINTS = 1; // dust floor — keep test/tiny swaps out of the ledger
const REFERRER_SHARE = 0.2; // 20% of referred user's volume, as points, to the referrer
const REFERRED_BONUS = 0.1; // 10% bonus, as points, to the referred user themselves

/**
 * Credits points for a swap that has reached its final confirmed state.
 * Called only from the server-side swap/bridge confirmation path — never
 * reachable from a client-supplied value. Idempotent via swap_transactions
 * .points_credited so a retried confirmation webhook can't double-credit.
 */
export async function creditSwapPoints(
  db: SupabaseClient,
  params: { swapId: string; userId: string; usdVolume: number },
): Promise<void> {
  const { swapId, userId, usdVolume } = params;
  if (usdVolume < MIN_VOLUME_USD_FOR_POINTS) return;

  const { data: swap, error: swapErr } = await db
    .from("swap_transactions")
    .select("points_credited")
    .eq("id", swapId)
    .single();
  if (swapErr || !swap) throw new Error(`Swap not found: ${swapId}`);
  if (swap.points_credited) return; // already credited, don't double-pay

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

  const { error: updateErr } = await db
    .from("swap_transactions")
    .update({ points_credited: true, usd_volume: usdVolume })
    .eq("id", swapId);
  if (updateErr) throw new Error(`Failed to mark swap as credited: ${updateErr.message}`);
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

  const { data: purchase, error: purchaseErr } = await db
    .from("nft_purchases")
    .select("points_credited")
    .eq("id", purchaseId)
    .single();
  if (purchaseErr || !purchase) throw new Error(`NFT purchase not found: ${purchaseId}`);
  if (purchase.points_credited) return; // already credited, don't double-pay

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

  const { error: updateErr } = await db
    .from("nft_purchases")
    .update({ points_credited: true, usd_volume: usdVolume })
    .eq("id", purchaseId);
  if (updateErr) throw new Error(`Failed to mark purchase as credited: ${updateErr.message}`);
}
