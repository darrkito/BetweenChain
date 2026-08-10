import { NextResponse } from "next/server";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 20;

// Push notifications v1 (2026-08-10) — stores a real browser PushManager
// subscription against the signed-in user. `endpoint` is unique across the
// whole table (real per-browser-installation identity from the push
// service, e.g. Chrome's FCM endpoint) — an upsert on it means re-
// subscribing on the same device/browser after already having done so
// (e.g. permission was reset) just refreshes the keys rather than growing
// duplicate rows forever.
export async function POST(req: Request) {
  const rl = await rateLimit(clientKey(req, "push:subscribe"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint: string | undefined = body?.endpoint;
  const p256dh: string | undefined = body?.keys?.p256dh;
  const auth: string | undefined = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint and keys.p256dh/keys.auth are required" }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const { error } = await db
      .from("push_subscriptions")
      .upsert({ user_id: session.userId, endpoint, p256dh, auth }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse("push/subscribe", err, 502);
  }
}

// Unsubscribe — called with the same endpoint PushManager.unsubscribe()
// was just told to drop, so the row doesn't linger sending pushes to a
// subscription the browser itself has already invalidated.
export async function DELETE(req: Request) {
  const rl = await rateLimit(clientKey(req, "push:unsubscribe"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint: string | undefined = body?.endpoint;
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });

  try {
    const db = supabaseAdmin();
    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", session.userId)
      .eq("endpoint", endpoint);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse("push/unsubscribe", err, 502);
  }
}
