import { NextResponse } from "next/server";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rateLimit, clientKey } from "@/lib/rate-limit";

/**
 * Lightweight "am I signed in" check — used by lib/client/AuthProvider.tsx
 * so the header's Connect Wallet popup can tell whether a just-connected
 * wallet already has a valid SIWS session (e.g. a page reload with the
 * session cookie still valid) versus needing the sign-in step, and whether
 * the currently-connected EVM address is already linked (evm_verified_address,
 * see migration 0007_evm_link.sql) versus needing its own sign step. Read-only,
 * no side effects — same cookie/verification path requireSession already
 * uses everywhere else.
 */
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "auth:session"), 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ solanaPubkey: null, evmVerifiedAddress: null }, { status: 401 });

  const { data: user } = await supabaseAdmin().from("users").select("evm_verified_address").eq("id", session.userId).maybeSingle();

  return NextResponse.json({ solanaPubkey: session.solanaPubkey, evmVerifiedAddress: user?.evm_verified_address ?? null });
}
