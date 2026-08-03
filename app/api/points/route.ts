import { NextResponse } from "next/server";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "points"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = supabaseAdmin();
  const [{ data: balanceRow }, { count: referralCount }] = await Promise.all([
    db.from("user_points_balance").select("balance").eq("user_id", session.userId).maybeSingle(),
    db.from("referrals").select("referred_user_id", { count: "exact", head: true }).eq("referrer_user_id", session.userId),
  ]);

  return NextResponse.json({
    balance: balanceRow?.balance ?? 0,
    referralCount: referralCount ?? 0,
  });
}
