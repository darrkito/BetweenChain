import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { verifyChallengeAndIssueSession } from "@/lib/auth/siws";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const bodySchema = z.object({
  solanaPubkey: z.string().min(32).max(44),
  nonce: z.string().min(1),
  signature: z.string().min(1), // base58-encoded ed25519 signature
});

export async function POST(req: Request) {
  const rl = await rateLimit(clientKey(req, "auth:verify"), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const { token } = await verifyChallengeAndIssueSession({
      solanaPubkey: parsed.data.solanaPubkey,
      nonce: parsed.data.nonce,
      signatureBase58: parsed.data.signature,
    });

    const jar = await cookies();
    jar.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}
