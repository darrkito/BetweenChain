import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, SessionError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getJupiterQuote, NATIVE_SOL_MINT } from "@/lib/chains/jupiter";
import { getRelayQuote, SOLANA_CHAIN_ID, RELAY_NATIVE_SOL_SENTINEL } from "@/lib/chains/relay";
import { isPlausibleEvmAddress } from "@/lib/validation";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const QUOTE_TTL_MS = 30_000; // matches Jupiter's own quote validity window

const bodySchema = z.object({
  sourceChainId: z.number().int().default(SOLANA_CHAIN_ID),
  sourceMint: z.string().min(1),
  sourceAmount: z.string().regex(/^\d+$/), // smallest-unit integer string
  // Required when sourceChainId isn't Solana — the connected EVM wallet's
  // address. Must always come from the actually-connected wallet on the
  // client, never a free-text field (see the refund-safety note in
  // lib/chains/relay.ts's getRelayQuote and STATE.md 2026-07-18i).
  sourceAddress: z.string().min(1).optional(),
  destChainId: z.number().int(), // Relay chain id; SOLANA_CHAIN_ID for same-chain
  destToken: z.string().min(1),
  destAddress: z.string().min(1),
  slippageBps: z.number().int().min(1).max(1000).default(100),
});

export async function POST(req: Request) {
  const session = await requireSession().catch((e: unknown) => {
    if (e instanceof SessionError) return null;
    throw e;
  });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, "quote"), 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;
  const isSolanaOrigin = input.sourceChainId === SOLANA_CHAIN_ID;

  if (!isSolanaOrigin && (!input.sourceAddress || !isPlausibleEvmAddress(input.sourceAddress))) {
    return NextResponse.json({ error: "Invalid or missing EVM source address" }, { status: 400 });
  }

  // 2026-08-06: same-chain EVM-to-EVM (e.g. USDC->ETH both on Arbitrum) used
  // to be rejected here — confirmed live it works fine against Relay's own
  // /quote (real single-step "swap" response, same settlement mechanism as
  // a real bridge). See app/components/SwapPanel.tsx's isBuyTokenAllowed
  // doc for the full finding.

  // Destination address validation is the security-critical step: this is
  // the value that gets bound immutably below and can never change again for
  // this quote, closing the MITM/address-swap scenario.
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
    let solAmount = input.sourceAmount;
    let jupiterRoute: unknown = null;
    let relayRoute: unknown = null;
    let expectedOutputMin: string | null = null;

    if (isSolanaOrigin) {
      // Only this branch actually needs a Solana signer — it's the wallet
      // that will sign the Jupiter/deposit transaction. An EVM-only session
      // (see migration 0008_evm_standalone_signin.sql) gets a clear error
      // here rather than a downstream Relay call silently passed `null`.
      if (!session.solanaPubkey) {
        return NextResponse.json({ error: "This action requires a Solana wallet — sign in with Solana to continue." }, { status: 400 });
      }

      // Existing Solana-origin path, unchanged: optional Jupiter leg
      // (arbitrary SPL -> SOL), then a Relay leg (SOL -> destination) if
      // cross-chain. See AGENTS.md.
      if (input.sourceMint !== NATIVE_SOL_MINT) {
        const jq = await getJupiterQuote({
          sourceMint: input.sourceMint,
          amount: input.sourceAmount,
          slippageBps: input.slippageBps,
        });
        solAmount = jq.outAmount;
        jupiterRoute = jq.route;
      }

      if (input.destChainId !== SOLANA_CHAIN_ID) {
        const rq = await getRelayQuote({
          amountLamports: solAmount,
          destChainId: input.destChainId,
          destToken: input.destToken,
          destAddress: input.destAddress,
          userSolanaAddress: session.solanaPubkey,
        });
        relayRoute = rq.quote;
        expectedOutputMin = rq.expectedOutAmount;
      } else {
        expectedOutputMin = solAmount;
      }
    } else {
      // Non-Solana origin: no Jupiter leg exists for this chain — Relay is
      // the entire execution engine, origin and destination both. Confirmed
      // live that Relay accepts arbitrary origin tokens directly (see
      // STATE.md 2026-07-18i) — no separate conversion step needed.
      const rq = await getRelayQuote({
        amountLamports: input.sourceAmount,
        destChainId: input.destChainId,
        // The client sends the literal string "SOL" for a Solana
        // destination (see SwapPanel.tsx) — never a real Relay currency
        // address, since a Solana-origin swap to Solana never used to reach
        // this call at all. Translate it before Relay sees it, or it
        // rejects the request outright. See lib/chains/relay.ts.
        destToken:
          input.destChainId === SOLANA_CHAIN_ID && input.destToken === "SOL"
            ? RELAY_NATIVE_SOL_SENTINEL
            : input.destToken,
        destAddress: input.destAddress,
        // No userSolanaAddress here — userOriginAddress below is already the
        // real signer for this leg (an EVM-only session has no Solana
        // pubkey to fall back to anyway, see migration
        // 0008_evm_standalone_signin.sql).
        originChainId: input.sourceChainId,
        originCurrency: input.sourceMint,
        userOriginAddress: input.sourceAddress,
      });
      relayRoute = rq.quote;
      expectedOutputMin = rq.expectedOutAmount;
    }

    const db = supabaseAdmin();
    const { data: quoteRow, error } = await db
      .from("swap_quotes")
      .insert({
        user_id: session.userId,
        source_chain: isSolanaOrigin ? "solana" : String(input.sourceChainId),
        source_mint: input.sourceMint,
        source_amount: input.sourceAmount,
        dest_chain: input.destChainId === SOLANA_CHAIN_ID ? "solana" : String(input.destChainId),
        dest_token: input.destToken,
        dest_address: input.destAddress,
        slippage_bps: input.slippageBps,
        expected_output_min: expectedOutputMin,
        jupiter_route: jupiterRoute,
        relay_route: relayRoute,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      })
      .select("id, expires_at")
      .single();

    if (error || !quoteRow) throw new Error(error?.message ?? "Failed to persist quote");

    return NextResponse.json({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      expectedOutputMin,
    });
  } catch (err) {
    return safeErrorResponse("quote", err, 502);
  }
}
