import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { SOLANA_CHAIN_ID } from "@/lib/chains/relay";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

// ClickPay (2026-08-08) — creates a shareable invoice/payment link
// (payment_links table, migration 0019). Session-required: a link is tied
// to its creator for listing/management purposes even though reading it
// back (GET /api/pay/[id]) is public — same "creation gated, reading
// public" split every other creator-facing content type in this app uses.
const bodySchema = z.object({
  destChainId: z.number().int(),
  destToken: z.string().min(1),
  destTokenSymbol: z.string().min(1),
  destTokenDecimals: z.number().int().min(0).max(18),
  destTokenLogoUri: z.string().optional(),
  destAddress: z.string().min(1),
  // null/omitted = open "donation" link — the payer picks the amount.
  amountRequested: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  label: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "pay:create"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  if (input.destChainId === SOLANA_CHAIN_ID) {
    try {
      new (await import("@solana/web3.js")).PublicKey(input.destAddress);
    } catch {
      return NextResponse.json({ error: "Invalid Solana destination address" }, { status: 400 });
    }
  } else if (!isPlausibleEvmAddress(input.destAddress)) {
    return NextResponse.json({ error: "Invalid EVM destination address" }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const { data: link, error } = await db
      .from("payment_links")
      .insert({
        creator_user_id: session.userId,
        dest_chain_id: input.destChainId,
        dest_token: input.destToken,
        dest_token_symbol: input.destTokenSymbol,
        dest_token_decimals: input.destTokenDecimals,
        dest_token_logo_uri: input.destTokenLogoUri ?? null,
        dest_address: input.destAddress,
        amount_requested: input.amountRequested ?? null,
        label: input.label ?? null,
      })
      .select("id")
      .single();
    if (error || !link) throw new Error(error?.message ?? "Failed to create payment link");

    return NextResponse.json({ id: link.id });
  } catch (err) {
    return safeErrorResponse("pay/create", err, 502);
  }
}
