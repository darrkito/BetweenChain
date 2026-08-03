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

const PREVIEW_TTL_MS = 5_000; // short — real quotes move fast, but this absorbs rapid re-renders/typing bursts

const querySchema = z.object({
  sourceChainId: z.coerce.number().int().default(SOLANA_CHAIN_ID),
  sourceMint: z.string().min(1),
  sourceAmount: z.string().regex(/^\d+$/),
  destChainId: z.coerce.number().int(),
  destToken: z.string().min(1),
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
    return NextResponse.json({ destAmountFormatted: "0", destAmountUsd: "0", rateLabel: null });
  }

  const cacheKey = `preview:${input.sourceChainId}:${input.sourceMint}:${input.sourceAmount}:${input.destChainId}:${input.destToken}`;

  try {
    const result = await cached(cacheKey, PREVIEW_TTL_MS, async () => {
      if (isSolanaOrigin) {
        // Existing Solana-origin preview path, unchanged.
        let solAmountLamports = input.sourceAmount;

        if (input.sourceMint !== NATIVE_SOL_MINT) {
          const jq = await getJupiterQuote({
            sourceMint: input.sourceMint,
            amount: input.sourceAmount,
            slippageBps: 100,
          });
          solAmountLamports = jq.outAmount;
        }

        // Same-chain destination is always native SOL in this app's current
        // architecture (leg 1 only ever produces SOL — see AGENTS.md); the
        // Buy-side token picker restricts Solana selections to native SOL for
        // exactly this reason, so destToken is ignored here on purpose.
        if (input.destChainId === SOLANA_CHAIN_ID) {
          const solUsdPrice = await getSolUsdPrice();
          return {
            destAmountFormatted: formatAtomicAmount(solAmountLamports, 9),
            destAmountUsd: lamportsToUsd(solAmountLamports, solUsdPrice).toFixed(2),
          };
        }

        const destChain = await getRelayChain(input.destChainId);
        const recipientPlaceholder = recipientPlaceholderFor(destChain?.vmType);
        if (!recipientPlaceholder) return { destAmountFormatted: null, destAmountUsd: null };

        const rq = await getRelayQuote({
          amountLamports: solAmountLamports,
          destChainId: input.destChainId,
          destToken: input.destToken,
          destAddress: recipientPlaceholder,
          userSolanaAddress: PREVIEW_SOLANA_PLACEHOLDER,
        });

        return {
          destAmountFormatted: rq.expectedOutAmountFormatted,
          destAmountUsd: rq.expectedOutAmountUsd,
        };
      }

      // Non-Solana origin: no Jupiter leg exists for this chain — go
      // straight to a direct Relay preview quote, same principle as
      // app/api/quote/route.ts's non-Solana-origin branch.
      const destChain = await getRelayChain(input.destChainId);
      const recipientPlaceholder = recipientPlaceholderFor(destChain?.vmType);
      if (!recipientPlaceholder) return { destAmountFormatted: null, destAmountUsd: null };

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
      });

      return {
        destAmountFormatted: rq.expectedOutAmountFormatted,
        destAmountUsd: rq.expectedOutAmountUsd,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
