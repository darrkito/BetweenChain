import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSolanaSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createTriggerOrder, createRecurringOrder } from "@/lib/chains/jupiterTrigger";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { SOLANA_CHAIN_ID } from "@/lib/chains/relay";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

export const maxDuration = 20;

// Trigger Orders (2026-08-08) — Solana-native limit orders + DCA on top of
// Jupiter's real Trigger/Recurring APIs (lib/chains/jupiterTrigger.ts).
// Session-required and Solana-anchored (requireSolanaSession) since every
// order is created and cancelled by the connected Solana wallet signing its
// own transaction — this route never signs anything itself, it only asks
// Jupiter to build the unsigned tx and returns it for the client to sign,
// same pattern as /api/swap.
const limitSchema = z.object({
  kind: z.literal("limit"),
  inputMint: z.string().min(1),
  inputSymbol: z.string().min(1),
  inputDecimals: z.number().int().min(0).max(18),
  outputMint: z.string().min(1),
  outputSymbol: z.string().min(1),
  outputDecimals: z.number().int().min(0).max(18),
  makingAmount: z.string().regex(/^\d+$/),
  takingAmount: z.string().regex(/^\d+$/),
  expiredAt: z.string().regex(/^\d+$/).optional(),
  destChainId: z.number().int().optional(),
  destAddress: z.string().min(1).optional(),
});

const dcaSchema = z.object({
  kind: z.literal("dca"),
  inputMint: z.string().min(1),
  inputSymbol: z.string().min(1),
  inputDecimals: z.number().int().min(0).max(18),
  outputMint: z.string().min(1),
  outputSymbol: z.string().min(1),
  outputDecimals: z.number().int().min(0).max(18),
  inAmount: z.string().regex(/^\d+$/), // TOTAL across all cycles, atomic units
  numberOfOrders: z.number().int().min(2).max(1000),
  intervalSeconds: z.number().int().min(3600), // Jupiter's own floor is hourly
  destChainId: z.number().int().optional(),
  destAddress: z.string().min(1).optional(),
});

const bodySchema = z.discriminatedUnion("kind", [limitSchema, dcaSchema]);

export async function POST(req: Request) {
  const session = await requireSolanaSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "A connected Solana wallet is required" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "orders:create"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  if (input.destChainId !== undefined && input.destChainId !== SOLANA_CHAIN_ID) {
    if (!input.destAddress) return NextResponse.json({ error: "destAddress required for cross-chain delivery" }, { status: 400 });
    if (!isPlausibleEvmAddress(input.destAddress)) return NextResponse.json({ error: "Invalid EVM destination address" }, { status: 400 });
  }

  try {
    const wallet = session.solanaPubkey;
    let unsigned: { order: string; transaction: string };

    if (input.kind === "limit") {
      unsigned = await createTriggerOrder({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        wallet,
        makingAmount: input.makingAmount,
        takingAmount: input.takingAmount,
        expiredAt: input.expiredAt,
      });
    } else {
      unsigned = await createRecurringOrder({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        wallet,
        inAmount: input.inAmount,
        numberOfOrders: input.numberOfOrders,
        intervalSeconds: input.intervalSeconds,
      });
    }

    const db = supabaseAdmin();
    const { data: row, error } = await db
      .from("trigger_orders")
      .insert({
        user_id: session.userId,
        jupiter_order_pubkey: unsigned.order,
        kind: input.kind,
        input_mint: input.inputMint,
        input_symbol: input.inputSymbol,
        input_decimals: input.inputDecimals,
        output_mint: input.outputMint,
        output_symbol: input.outputSymbol,
        output_decimals: input.outputDecimals,
        making_amount: input.kind === "limit" ? input.makingAmount : input.inAmount,
        taking_amount: input.kind === "limit" ? input.takingAmount : null,
        cycle_amount: input.kind === "dca" ? String(Number(input.inAmount) / input.numberOfOrders) : null,
        cycle_frequency_seconds: input.kind === "dca" ? input.intervalSeconds : null,
        dest_chain_id: input.destChainId ?? null,
        dest_address: input.destAddress ?? null,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Failed to save order");

    return NextResponse.json({ id: row.id, orderPubkey: unsigned.order, transaction: unsigned.transaction });
  } catch (err) {
    return safeErrorResponse("orders/create", err, 502);
  }
}
