import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getPaymentLink } from "@/lib/payments/links";
import { getJupiterQuote, NATIVE_SOL_MINT } from "@/lib/chains/jupiter";
import { getRelayCallQuote, SOLANA_CHAIN_ID, RELAY_NATIVE_SOL_SENTINEL, RELAY_NATIVE_EVM_SENTINEL } from "@/lib/chains/relay";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { toAtomicAmount } from "@/lib/client/amount";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const QUOTE_TTL_MS = 30_000; // matches app/api/quote/route.ts's own window

// ClickPay quote (2026-08-08) — a payer resolves "how much of my native
// SOURCE currency do I need to send to deliver EXACTLY what this invoice
// asks for." Reuses swap_quotes (via the payment_link_id column added in
// migration 0019) rather than a parallel table — this is a real swap, just
// one whose destination terms are fixed by the invoice instead of typed by
// the payer, so the entire downstream execution pipeline
// (/api/swap, /api/swap/confirm, /api/bridge, /api/bridge/confirm) needs
// zero changes to handle it.
//
// v1 payment sources are native-currency only (SOL, or the connected EVM
// chain's own native token) — see the plan doc's reasoning: an arbitrary
// SPL/ERC20 source would need a second exact-output hop chained backward
// from Relay's required origin amount, real but not proven anywhere in
// this app yet.
const bodySchema = z.object({
  sourceChainId: z.number().int(),
  // Required when sourceChainId isn't Solana — same convention
  // app/api/quote/route.ts already uses for an EVM origin.
  sourceAddress: z.string().min(1).optional(),
  // Only meaningful for an open/"donation" link (payment_links.amount_requested
  // is null) — the payer picks how much to send. Ignored otherwise; the
  // invoice's own fixed amount always wins so a payer can't under/overpay
  // a fixed invoice by tampering with this field.
  amountOverride: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "pay:quote"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  const link = await getPaymentLink(id);
  if (!link) return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  const db = supabaseAdmin();

  const amountRequested = link.amount_requested ?? input.amountOverride;
  if (!amountRequested) {
    return NextResponse.json({ error: "This is an open payment link — specify an amount" }, { status: 400 });
  }

  const isSolanaOrigin = input.sourceChainId === SOLANA_CHAIN_ID;
  if (isSolanaOrigin && !session.solanaPubkey) {
    return NextResponse.json({ error: "This action requires a Solana wallet — sign in with Solana to continue." }, { status: 400 });
  }
  if (!isSolanaOrigin && (!input.sourceAddress || !isPlausibleEvmAddress(input.sourceAddress))) {
    return NextResponse.json({ error: "Invalid or missing EVM source address" }, { status: 400 });
  }

  const destMint = link.dest_chain_id === SOLANA_CHAIN_ID && link.dest_token === "SOL" ? NATIVE_SOL_MINT : link.dest_token;
  const destAmountAtomic = toAtomicAmount(String(amountRequested), link.dest_token_decimals);

  // Same-chain, same-native-currency payment (e.g. an invoice asking for
  // native SOL, paid from a Solana wallet) is a plain wallet-to-wallet
  // transfer, not a swap — neither Jupiter nor Relay has a sane quote for
  // "convert X into X" (the general /swap page already blocks the
  // equivalent EVM case for the same reason: a real Relay transaction that
  // burns gas for no effect). Not supported via ClickPay v1; the payer
  // should just send directly to the invoice's own address in this case.
  const isSameChain = input.sourceChainId === link.dest_chain_id;
  const sourceNativeSentinel = isSolanaOrigin ? NATIVE_SOL_MINT : RELAY_NATIVE_EVM_SENTINEL;
  if (isSameChain && destMint.toLowerCase() === sourceNativeSentinel.toLowerCase()) {
    return NextResponse.json(
      { error: "This invoice requests the native chain currency directly — pay it as a normal wallet transfer, not via ClickPay." },
      { status: 400 },
    );
  }

  try {
    let sourceAmount: string;
    let jupiterRoute: unknown = null;
    let relayRoute: unknown = null;

    if (isSolanaOrigin && link.dest_chain_id === SOLANA_CHAIN_ID) {
      const jq = await getJupiterQuote({
        sourceMint: NATIVE_SOL_MINT,
        destinationMint: destMint,
        amount: destAmountAtomic,
        slippageBps: 100,
        swapMode: "ExactOut",
      });
      sourceAmount = jq.inAmount;
      jupiterRoute = jq.route;
    } else {
      const rq = await getRelayCallQuote({
        originChainId: input.sourceChainId,
        originCurrency: isSolanaOrigin ? RELAY_NATIVE_SOL_SENTINEL : RELAY_NATIVE_EVM_SENTINEL,
        userOriginAddress: isSolanaOrigin ? session.solanaPubkey! : input.sourceAddress!,
        destChainId: link.dest_chain_id,
        destCurrency: destMint,
        destAmount: destAmountAtomic,
        recipient: link.dest_address,
      });
      sourceAmount = rq.originAmount;
      relayRoute = rq.quote;
    }

    const { data: quoteRow, error } = await db
      .from("swap_quotes")
      .insert({
        user_id: session.userId,
        source_chain: isSolanaOrigin ? "solana" : String(input.sourceChainId),
        source_mint: sourceNativeSentinel,
        source_amount: sourceAmount,
        dest_chain: link.dest_chain_id === SOLANA_CHAIN_ID ? "solana" : String(link.dest_chain_id),
        dest_token: link.dest_token,
        dest_address: link.dest_address,
        expected_output_min: destAmountAtomic,
        jupiter_route: jupiterRoute,
        relay_route: relayRoute,
        payment_link_id: link.id,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      })
      .select("id, expires_at")
      .single();
    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      sourceAmount,
      sourceChainId: input.sourceChainId,
    });
  } catch (err) {
    return safeErrorResponse("pay/quote", err, 502);
  }
}
