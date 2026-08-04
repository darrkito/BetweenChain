import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildRelayExecutionSteps } from "@/lib/chains/relay";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const bodySchema = z.object({ swapId: z.string().uuid() });

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "bridge"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: swap, error: swapErr } = await db
    .from("swap_transactions")
    .select("*, swap_quotes(*)")
    .eq("id", parsed.data.swapId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (swapErr || !swap) return NextResponse.json({ error: "Swap not found" }, { status: 404 });

  // Resumable by design: leg2_pending or leg2_failed are both valid states to
  // (re)issue the bridge steps from — a user whose tab closed mid-bridge, or
  // whose leg2 attempt failed, can call this again for the same swapId
  // without ever re-running leg1 or changing the bound destination address.
  if (!["leg1_confirmed", "leg2_pending", "leg2_failed"].includes(swap.status)) {
    return NextResponse.json({ error: `Cannot bridge from status: ${swap.status}` }, { status: 400 });
  }
  if (swap.swap_quotes.dest_chain === "solana") {
    return NextResponse.json({ error: "This swap has no cross-chain leg" }, { status: 400 });
  }

  try {
    const steps = await buildRelayExecutionSteps(swap.swap_quotes.relay_route);
    await db
      .from("swap_transactions")
      .update({ status: "leg2_pending", updated_at: new Date().toISOString() })
      .eq("id", swap.id);
    return NextResponse.json({ swapId: swap.id, status: "leg2_pending", steps });
  } catch (err) {
    await db.from("swap_transactions").update({ status: "leg2_failed" }).eq("id", swap.id);
    return safeErrorResponse("bridge", err, 502);
  }
}
