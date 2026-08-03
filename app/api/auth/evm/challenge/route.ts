import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { issueEvmChallenge } from "@/lib/auth/siwe";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const bodySchema = z.object({ evmAddress: z.string().min(1) });

/**
 * Works in two modes, mirroring verify's branching (see
 * app/api/auth/evm/verify/route.ts and lib/auth/siwe.ts):
 * - An existing session present -> link mode, attaches this EVM address
 *   onto that account (migration 0007_evm_link.sql).
 * - No session -> standalone mode, a real Sign-In-with-Ethereum challenge
 *   with no Solana wallet required at all (migration
 *   0008_evm_standalone_signin.sql). An existing session always wins this
 *   branch, deliberately — a user who's already signed in with Solana
 *   should never accidentally get switched onto a different, EVM-anchored
 *   account just by connecting an EVM wallet.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });

  const rl = await rateLimit(clientKey(req, "auth:evm:challenge"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isPlausibleEvmAddress(parsed.data.evmAddress)) {
    return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  }

  try {
    const { nonce, message } = await issueEvmChallenge(parsed.data.evmAddress, session?.userId);
    return NextResponse.json({ nonce, message });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
