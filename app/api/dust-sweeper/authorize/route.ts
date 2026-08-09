import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSolanaSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildBatchDelegateApprovalTransaction } from "@/lib/relayer/delegateApproval";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 20;

// OmniDust Vacuum (2026-08-09, v1 Solana-only) — session-required, builds
// ONE batch delegate-approval transaction (lib/relayer/delegateApproval.ts)
// covering every dust token the client already detected (reusing Dust
// Sweeper's existing scan, never re-detected server-side) at its REAL
// current balance. Returns null (no transaction) when the relayer isn't
// configured — caller falls back to the existing manual per-item sweep.
const bodySchema = z.object({
  tokens: z
    .array(
      z.object({
        mint: z.string().min(1),
        symbol: z.string().min(1),
        decimals: z.number().int().min(0).max(18),
        amountAtomic: z.string().regex(/^\d+$/),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(req: Request) {
  const session = await requireSolanaSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "A connected Solana wallet is required" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "dust-sweeper:authorize"), 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { tokens } = parsed.data;

  try {
    const built = await buildBatchDelegateApprovalTransaction({
      owner: session.solanaPubkey,
      tokens: tokens.map((t) => ({ mint: t.mint, decimals: t.decimals, amountAtomic: BigInt(t.amountAtomic) })),
    });
    if (!built) return NextResponse.json({ transaction: null });

    const db = supabaseAdmin();
    const { error } = await db.from("dust_sweep_authorizations").insert(
      tokens.map((t) => ({
        user_id: session.userId,
        token_mint: t.mint,
        token_symbol: t.symbol,
        token_decimals: t.decimals,
        delegate_amount: t.amountAtomic,
        delivery_status: "pending",
      })),
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ transaction: built.transaction });
  } catch (err) {
    return safeErrorResponse("dust-sweeper/authorize", err, 502);
  }
}
