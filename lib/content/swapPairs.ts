import { EVM_CHAINS, type EvmChainOption } from "@/lib/nft/evmChains";
import { SOLANA_SWAP_CHAIN } from "@/lib/chains/swapChains";

export interface SwapPair {
  slug: string;
  from: EvmChainOption;
  to: EvmChainOption;
}

// Scoped to pairs that include Solana (2026-08-07, explicit decision — see
// PLAN.md) — this product's real differentiated value is Solana<->EVM, not
// EVM-to-EVM (where it has no edge over a native DEX aggregator). 6 EVM
// chains x 2 directions = 12 pages.
export const SWAP_PAIRS: SwapPair[] = EVM_CHAINS.flatMap((evmChain) => [
  { slug: `solana-to-${evmChain.slug}`, from: SOLANA_SWAP_CHAIN, to: evmChain },
  { slug: `${evmChain.slug}-to-solana`, from: evmChain, to: SOLANA_SWAP_CHAIN },
]);

export function pairForSlug(slug: string): SwapPair | undefined {
  return SWAP_PAIRS.find((p) => p.slug === slug);
}

/** Other pairs sharing a chain with `pair`, for related-page internal links. */
export function relatedPairs(pair: SwapPair, limit = 3): SwapPair[] {
  return SWAP_PAIRS.filter((p) => p.slug !== pair.slug && (p.from.slug === pair.from.slug || p.to.slug === pair.to.slug)).slice(
    0,
    limit,
  );
}

export interface SwapPairCopy {
  intro: string;
  howItWorks: string[];
  faq: Array<{ question: string; answer: string }>;
}

/**
 * Templated, not hand-authored per pair — real substituted facts only.
 * The fee sentence is deliberately the SINGLE-LEG figure (0.25% total, not
 * "per leg"): every page here defaults to native-token-to-native-token
 * (see QuotePreviewWidget's initialSellChainId/initialBuyChainId), and
 * app/api/quote/route.ts's actual leg logic means Jupiter only activates for
 * a non-native SOLANA-side sell — a native/native swap in either direction
 * is always a single Relay leg. Don't change this sentence to "per leg"
 * without re-checking that route's logic first.
 */
export function swapPairCopy(pair: SwapPair): SwapPairCopy {
  const { from, to } = pair;
  return {
    intro: `Swap directly from ${from.label} to ${to.label} — no manual bridging step, no wrapping, one destination address. The default (native-token-to-native-token) swap costs a flat 0.25% platform fee, plus network gas — swapping a different Solana token instead of SOL adds a second 0.25% conversion leg before bridging.`,
    howItWorks: [
      `Pick the token you're selling on ${from.label} and the token you want on ${to.label} — this page already has both sides set to each chain's native token.`,
      `Review the live quote — real rate, real fee breakdown, no wallet connection required to preview.`,
      `Connect your wallet and confirm — the destination address is locked in at quote time and can't be changed afterward.`,
    ],
    faq: [
      {
        question: `What does it cost to swap ${from.label} to ${to.label}?`,
        answer: `0.25% of the swap amount as a platform fee, plus the network's own gas fee. Swapping a non-native Solana token (not SOL) adds a second 0.25% leg for the on-Solana conversion step before bridging.`,
      },
      {
        question: `How long does a ${from.label} to ${to.label} swap take?`,
        answer: `It depends on network conditions on both chains — Blockchains.Click doesn't guarantee a fixed time. There's no separate manual bridging step to wait on; once you sign, delivery happens automatically.`,
      },
      {
        question: `Do I need a wallet on both ${from.label} and ${to.label}?`,
        answer: `You need a wallet on ${from.label} to sign the swap. The destination address on ${to.label} can be your own wallet or any address you specify — it doesn't need to be connected.`,
      },
      {
        question: `Can I swap a different token than the native one shown here?`,
        answer: `Yes — this page defaults to native-to-native for the clearest live quote, but you can pick any supported token on either side once you continue to the full swap page.`,
      },
    ],
  };
}
