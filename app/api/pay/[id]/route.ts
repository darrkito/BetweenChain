import { NextResponse } from "next/server";
import { getPaymentLink } from "@/lib/payments/links";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// Public, unauthenticated — an invoice's terms aren't secret, the payer
// needs to see them before signing in to pay. Same "public read via a
// service-role-backed Next.js route, never direct PostgREST" posture every
// other table in this app uses (see migration 0019's own comment).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(clientKey(req, "pay:get"), 60, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id } = await params;

  try {
    const link = await getPaymentLink(id);
    if (!link) return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    return NextResponse.json({ link });
  } catch (err) {
    return safeErrorResponse("pay/get", err, 502);
  }
}
