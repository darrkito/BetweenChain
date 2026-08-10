import "server-only";
import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server";

// Push notifications v1 (2026-08-10) — see PLAN.md's "Push notifications —
// feasibility check" for the full scoping. Standard Web Push (VAPID), no
// vendor account, no new custody/signing implication — this only ever
// sends text a user already agreed to receive, never moves funds or acts
// on their behalf (same "no new custody" bar every feature in this app is
// held to).
function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}

let vapidSet = false;
function ensureVapid() {
  if (vapidSet || !configured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidSet = true;
}

/**
 * Sends `payload` to every subscription a user has (desktop + phone, etc).
 * A dead/expired subscription (push service returns 404/410 — the
 * standard "this endpoint no longer exists" response) is deleted so it
 * stops being retried forever; any other failure is logged and otherwise
 * ignored — a failed notification must never fail or roll back the real
 * action that triggered it (an order still filled/delivered even if the
 * phone announcing that fact didn't get the memo). No-ops entirely when
 * VAPID isn't configured, so this is always safe to call unconditionally
 * from a trigger point without an extra feature-flag check at each call site.
 */
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  if (!configured()) return;
  ensureVapid();

  const db = supabaseAdmin();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs || subs.length === 0) return;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[push] send failed", sub.id, err);
        }
      }
    }),
  );
}
