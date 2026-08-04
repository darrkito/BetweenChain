import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { requireSession, SessionError, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { verifyEvmChallengeAndLink, verifyEvmChallengeAndSignIn } from "@/lib/auth/siwe";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({
  evmAddress: z.string().min(1),
  nonce: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/), // 65-byte ECDSA personal_sign signature
});

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Same two-mode branch as challenge/route.ts. Link mode returns `{ok:true}`
 * only — the existing session cookie is already valid, nothing to reissue.
 * Standalone mode mints a brand new session and sets the cookie itself,
 * same as /api/auth/verify (SIWS) does.
 */
export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });

  const rl = await rateLimit(clientKey(req, "auth:evm:verify"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isPlausibleEvmAddress(parsed.data.evmAddress)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (session) {
      await verifyEvmChallengeAndLink({
        userId: session.userId,
        evmAddress: parsed.data.evmAddress,
        nonce: parsed.data.nonce,
        signatureHex: parsed.data.signature,
      });
      return NextResponse.json({ ok: true });
    }

    const { token } = await verifyEvmChallengeAndSignIn({
      evmAddress: parsed.data.evmAddress,
      nonce: parsed.data.nonce,
      signatureHex: parsed.data.signature,
    });

    const jar = await cookies();
    jar.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse("auth/evm/verify", err, 401, "Authentication failed");
  }
}
