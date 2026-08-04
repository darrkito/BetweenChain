import { NextResponse } from "next/server";
import { z } from "zod";
import { issueChallenge } from "@/lib/auth/siws";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

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
    return safeErrorResponse("auth/challenge", err, 400, "Invalid request");
  }
}
