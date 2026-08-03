import { NextResponse } from "next/server";
import { z } from "zod";
import { issueChallenge } from "@/lib/auth/siws";
import { rateLimit, clientKey } from "@/lib/rate-limit";

const bodySchema = z.object({
  solanaPubkey: z.string().min(32).max(44),
});

export async function POST(req: Request) {
  const rl = await rateLimit(clientKey(req, "auth:challenge"), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const { nonce, message } = await issueChallenge(parsed.data.solanaPubkey);
    return NextResponse.json({ nonce, message });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
