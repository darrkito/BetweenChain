import { NextResponse } from "next/server";
import { z } from "zod";
import { cached } from "@/lib/cache";
import { getJupiterQuote, NATIVE_SOL_MINT } from "@/lib/chains/jupiter";
import {
  getRelayQuote,
  SOLANA_CHAIN_ID,
  RELAY_NATIVE_SOL_SENTINEL,
  PREVIEW_SOLANA_PLACEHOLDER,
  PREVIEW_EVM_PLACEHOLDER,
  PREVIEW_EVM_ORIGIN_PLACEHOLDER,
} from "@/lib/chains/relay";
import { getRelayChain } from "@/lib/chains/relayChains";
import { getSolUsdPrice, lamportsToUsd, formatAtomicAmount } from "@/lib/pricing";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/apiError";
import { feeBreakdownWithAmounts } from "@/lib/fees";
import { describeExecutionRoute } from "@/lib/chains/executionRoute";

// External-call budget for this route -- prevents Vercel's platform-level
// function timeout from killing the request with an empty/non-JSON body
// before our own error handling gets a chance to run (see
// lib/fetchWithTimeout.ts's doc comment for the failure mode this closes).
export const maxDuration = 20;

const PREVIEW_TTL_MS = 5_000; // short — real quotes move fast, but this absorbs rapid re-renders/typing bursts

const querySchema = z.object({
  sourceChainId: z.coerce.number().int().default(SOLANA_CHAIN_ID),
  sourceMint: z.string().min(1),
  sourceAmount: z.string().regex(/^\d+$/),
  destChainId: z.coerce.number().int(),
  destToken: z.string().min(1),
  // Only meaningful for a same-chain Solana destination that isn't native
  // SOL (2026-08-07, SPL<->SPL swaps) — needed to format the raw atomic
  // Jupiter quote amount, since arbitrary SPL tokens don't share SOL's
  // fixed 9 decimals. Every other branch ignores this.
  destDecimals: z.coerce.number().int().min(0).max(18).optional(),
  // Just-In-Time Gas (2026-08-07) — see getRelayQuote's doc; safe to pass
  // unconditionally, Relay no-ops it for a non-EVM/already-native destination.
  autoRefuel: z.coerce.boolean().default(false),
});

function recipientPlaceholderFor(vmType: string | undefined): string | null {
  if (vmType === "svm") return PREVIEW_SOLANA_PLACEHOLDER;
  if (vmType === "evm") return PREVIEW_EVM_PLACEHOLDER;
  return null; // rare non-EVM/SVM destinations aren't covered by the placeholder shapes above
}

/**
 * Public, unauthenticated price preview — "how much would I get" before a
 * wallet is even connected. Deliberately separate from POST /api/quote:
 * that route creates a single-use, address-bound swap_quotes row and
 * requires a session (see SECURITY.md); this route creates nothing, binds
 * nothing, and can never be used to execute a swap. It uses well-known
 * placeholder sender/recipient addresses when calling Relay, since pricing
 * doesn't depend on the real destination — verified live during
 * implementation that Relay returns full, accurate quotes for any
 * well-formed placeholder pair (sender and recipient just need to differ).
 */
export async function GET(req: Request) {
  const rl = await rateLimit(clientKey(req, "quote:preview"), 40, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;
  const isSolanaOrigin = input.sourceChainId === SOLANA_CHAIN_ID;

  if (input.sourceAmount === "0") {
    return NextResponse.json({
      destAmountFormatted: "0",
      destAmountUsd: "0",
      rateLabel: null,
      feeBreakdown: [],
      route: [],
      autoRefuelAvailable: false,
    });
  }

  const cacheKey = `preview:${input.sourceChainId}:${input.sourceMint}:${input.sourceAmount}:${input.destChainId}:${input.destToken}:${input.autoRefuel}`;

  try {
    const result = await cached(cacheKey, PREVIEW_TTL_MS, async () => {
      const sourceIsNativeSol = input.sourceMint === NATIVE_SOL_MINT;

      if (isSolanaOrigin) {
        // Same-chain Solana destination (2026-08-07: any SPL mint, not just
        // native SOL — real gap found live, this used to force every
        // Solana->Solana preview through a SOL-shaped response regardless of
        // what destToken actually was). Handled entirely separately from the
        // cross-chain path below: a same-chain quote is always exactly zero
        // or one Jupiter leg, direct source->destination, never a two-hop
        // "convert to SOL first" — Jupiter's own aggregator already routes
        // through SOL internally when that's the best path.
        if (input.destChainId === SOLANA_CHAIN_ID) {
          const destMint = input.destToken === "SOL" ? NATIVE_SOL_MINT : input.destToken;

          if (destMint === input.sourceMint) {
            // Same-token same-chain — not a real trade. The UI already
            // blocks picking this; this is a defensive no-op for direct
            // callers of this public route.
            return { destAmountFormatted: null, destAmountUsd: null, feeBreakdown: [], route: [], autoRefuelAvailable: false };
          }

          if (destMint === NATIVE_SOL_MINT) {
            // sourceIsNativeSol is guaranteed false here (both-SOL was
            // caught by the same-token check above).
            const jq = await getJupiterQuote({ sourceMint: input.sourceMint, amount: input.sourceAmount, slippageBps: 100 });
            const solUsdPrice = await getSolUsdPrice();
            const destAmountUsd = lamportsToUsd(jq.outAmount, solUsdPrice).toFixed(2);
            return {
              destAmountFormatted: formatAtomicAmount(jq.outAmount, 9),
              destAmountUsd,
              feeBreakdown: feeBreakdownWithAmounts({ isSolanaOrigin, needsJupiterLeg: true, isCrossChain: false }, destAmountUsd),
              route: describeExecutionRoute({ isSolanaOrigin, needsJupiterLeg: true, isCrossChain: false }),
              autoRefuelAvailable: false, // same-chain Solana destination — Relay's topupGas is EVM-destination only
            };
          }

          // Arbitrary non-SOL SPL destination — direct Jupiter quote
          // (works with a native-SOL source too: SOL -> SPL is a real,
          // valid Jupiter quote, not a special case). No USD price source
          // for arbitrary SPL tokens exists in this app yet (lib/pricing.ts
          // only covers SOL/ETH/SUI) — destAmountUsd is honestly null
          // rather than fabricated; the fee breakdown degrades gracefully
          // to "—" per leg, same as any other unpriced preview.
          const jq = await getJupiterQuote({
            sourceMint: input.sourceMint,
            destinationMint: destMint,
            amount: input.sourceAmount,
            slippageBps: 100,
          });
          return {
            destAmountFormatted: formatAtomicAmount(jq.outAmount, input.destDecimals ?? 0),
            destAmountUsd: null,
            feeBreakdown: feeBreakdownWithAmounts({ isSolanaOrigin, needsJupiterLeg: true, isCrossChain: false }, null),
            route: describeExecutionRoute({ isSolanaOrigin, needsJupiterLeg: true, isCrossChain: false }),
            autoRefuelAvailable: false,
          };
        }

        // Cross-chain: existing behavior, unchanged — always convert a
        // non-native source to SOL first (leg 1), then Relay bridges the SOL
        // onward (leg 2). Cross-chain delivery is native-SOL-only on the
        // Solana side; there's no equivalent of the same-chain arbitrary-SPL
        // path above for a bridged destination.
        let solAmountLamports = input.sourceAmount;
        if (!sourceIsNativeSol) {
          const jq = await getJupiterQuote({
            sourceMint: input.sourceMint,
            amount: input.sourceAmount,
            slippageBps: 100,
          });
          solAmountLamports = jq.outAmount;
        }

        const destChain = await getRelayChain(input.destChainId);
        const recipientPlaceholder = recipientPlaceholderFor(destChain?.vmType);
        if (!recipientPlaceholder)
          return { destAmountFormatted: null, destAmountUsd: null, feeBreakdown: [], route: [], autoRefuelAvailable: false };

        const rq = await getRelayQuote({
          amountLamports: solAmountLamports,
          destChainId: input.destChainId,
          destToken: input.destToken,
          destAddress: recipientPlaceholder,
          userSolanaAddress: PREVIEW_SOLANA_PLACEHOLDER,
          topupGas: input.autoRefuel,
        });

        return {
          destAmountFormatted: rq.expectedOutAmountFormatted,
          destAmountUsd: rq.expectedOutAmountUsd,
          feeBreakdown: feeBreakdownWithAmounts(
            { isSolanaOrigin, needsJupiterLeg: !sourceIsNativeSol, isCrossChain: true },
            rq.expectedOutAmountUsd,
          ),
          route: describeExecutionRoute({ isSolanaOrigin, needsJupiterLeg: !sourceIsNativeSol, isCrossChain: true }),
          autoRefuelAvailable: destChain?.vmType === "evm",
        };
      }

      // Non-Solana origin: no Jupiter leg exists for this chain — go
      // straight to a direct Relay preview quote, same principle as
      // app/api/quote/route.ts's non-Solana-origin branch.
      const destChain = await getRelayChain(input.destChainId);
      const recipientPlaceholder = recipientPlaceholderFor(destChain?.vmType);
      if (!recipientPlaceholder)
        return { destAmountFormatted: null, destAmountUsd: null, feeBreakdown: [], route: [], autoRefuelAvailable: false };

      const rq = await getRelayQuote({
        amountLamports: input.sourceAmount,
        destChainId: input.destChainId,
        // Translate the client's "SOL" placeholder before Relay sees it —
        // see the identical note in app/api/quote/route.ts.
        destToken:
          input.destChainId === SOLANA_CHAIN_ID && input.destToken === "SOL"
            ? RELAY_NATIVE_SOL_SENTINEL
            : input.destToken,
        destAddress: recipientPlaceholder,
        userSolanaAddress: PREVIEW_SOLANA_PLACEHOLDER,
        originChainId: input.sourceChainId,
        originCurrency: input.sourceMint,
        // Distinct from the recipient placeholder — Relay rejects
        // sender === recipient, and both could otherwise land on the same
        // EVM burn address when origin and destination are both EVM chains.
        userOriginAddress: PREVIEW_EVM_ORIGIN_PLACEHOLDER,
        topupGas: input.autoRefuel,
      });

      return {
        destAmountFormatted: rq.expectedOutAmountFormatted,
        destAmountUsd: rq.expectedOutAmountUsd,
        feeBreakdown: feeBreakdownWithAmounts(
          { isSolanaOrigin, needsJupiterLeg: false, isCrossChain: true },
          rq.expectedOutAmountUsd,
        ),
        autoRefuelAvailable: destChain?.vmType === "evm",
        route: describeExecutionRoute({ isSolanaOrigin, needsJupiterLeg: false, isCrossChain: true }),
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return safeErrorResponse("quote/preview", err, 502);
  }
}
