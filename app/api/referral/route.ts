import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rate-limit";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

async function getSessionOr401() {
  return requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
}

// GET: return (or create) the caller's own invite code.
export async function GET() {
  const session = await getSessionOr401();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("invite_codes")
    .select("code")
    .eq("owner_id", session.userId)
    .maybeSingle();
  if (existing) return NextResponse.json({ code: existing.code });

  const code = randomBytes(4).toString("hex");
  const { error } = await db.from("invite_codes").insert({ code, owner_id: session.userId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ code });
}

const redeemSchema = z.object({ code: z.string().min(1) });

// POST: redeem an invite code — only valid once per user, at (or before)
// their first swap, and immutable afterward per the referrals table's PK.
export async function POST(req: Request) {
  const session = await getSessionOr401();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "referral:redeem"), 5, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = redeemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: invite, error: inviteErr } = await db
    .from("invite_codes")
    .select("code, owner_id")
    .eq("code", parsed.data.code)
    .maybeSingle();
  if (inviteErr || !invite) return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  if (invite.owner_id === session.userId) {
    return NextResponse.json({ error: "Cannot redeem your own invite code" }, { status: 400 });
  }

  const { error: insertErr } = await db.from("referrals").insert({
    referred_user_id: session.userId,
    referrer_user_id: invite.owner_id,
    invite_code: invite.code,
  });
  if (insertErr) {
    // PK violation means this user already has a referrer — immutable by design.
    return NextResponse.json({ error: "Referral already set for this account" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
