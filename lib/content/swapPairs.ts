import { EVM_CHAINS, evmChainForSlug, type EvmChainOption } from "@/lib/nft/evmChains";
import { SOLANA_SWAP_CHAIN, BTC_CHAIN_ID, BTC_ICON_URL, SUI_CHAIN_ID, SUI_CHAIN_INFO } from "@/lib/chains/swapChains";

export interface SwapPair {
  slug: string;
  from: EvmChainOption;
  to: EvmChainOption;
  // "relay" (Jupiter/Relay, wallet-signed, 0.25%/leg platform fee) vs
  // "changenow" (custodial deposit-address exchange, no platform fee) —
  // added 2026-08-18 alongside the first changenow pairs. The two engines
  // have genuinely different mechanics/fees/risk model, so swapPairCopy
  // below branches on this rather than templating both with one voice.
  engine: "relay" | "changenow";
}

const ETHEREUM = evmChainForSlug("ethereum")!;

// Synthetic EvmChainOption-shaped entries for Bitcoin/Sui — real chain ids/
// icons (see BTC_CHAIN_ID/BTC_ICON_URL/SUI_CHAIN_INFO's own docs), just not
// sourced from EVM_CHAINS since neither is an EVM chain. Deliberately NOT
// added to EVM_CHAINS/SWAP_CHAINS itself (see those files' own docs on why
// BTC/Sui are kept out of Relay-execution-assuming registries) — this
// shape is only ever consumed as {slug, label, chainId, iconUrl} by this
// file and app/swap/[pair]/page.tsx, so a local synthetic object is
// simpler than threading a new union type through both.
const BITCOIN_PAIR_CHAIN: EvmChainOption = { slug: "bitcoin", label: "Bitcoin", chainId: BTC_CHAIN_ID, iconUrl: BTC_ICON_URL };
const SUI_PAIR_CHAIN: EvmChainOption = { slug: "sui", label: "Sui", chainId: SUI_CHAIN_ID, iconUrl: SUI_CHAIN_INFO.iconUrl ?? "" };

// Scoped to pairs that include Solana (2026-08-07, explicit decision — see
// PLAN.md) — this product's real differentiated value is Solana<->EVM, not
// EVM-to-EVM (where it has no edge over a native DEX aggregator). EVM_CHAINS'
// length x 2 directions = however many pages that produces (7 chains x 2 =
// 14 as of 2026-08-18, after Robinhood Chain was added post-dating this
// comment's original "6 chains x 2 = 12" — count intentionally not
// hardcoded here anymore, so this can't go stale the same way again).
const RELAY_SWAP_PAIRS: SwapPair[] = EVM_CHAINS.flatMap((evmChain) => [
  { slug: `solana-to-${evmChain.slug}`, from: SOLANA_SWAP_CHAIN, to: evmChain, engine: "relay" as const },
  { slug: `${evmChain.slug}-to-solana`, from: evmChain, to: SOLANA_SWAP_CHAIN, engine: "relay" as const },
]);

// BTC/Sui pairs (2026-08-18) — real gap found while investigating a user
// question about Arbitrum->Sui support: this app's ChangeNOW-backed BTC/Sui
// swap capability (live since 2026-08-08/2026-08-18) had ZERO dedicated
// landing pages, unlike every Solana<->EVM pair above. Scoped to Solana,
// Ethereum mainnet, and each other as the non-BTC/Sui side — matches
// isSellTokenAllowedForBtcPair/isBuyTokenAllowed's own default scope
// (SwapPanel.tsx), not the full L2 set that function also allows for a Sui
// destination specifically — a dedicated page per L2 would be low-value,
// near-duplicate content; the L2 capability is mentioned in the FAQ copy
// below instead, discoverable via the main /swap picker.
const CHANGENOW_SWAP_PAIRS: SwapPair[] = [
  { slug: "solana-to-bitcoin", from: SOLANA_SWAP_CHAIN, to: BITCOIN_PAIR_CHAIN, engine: "changenow" },
  { slug: "bitcoin-to-solana", from: BITCOIN_PAIR_CHAIN, to: SOLANA_SWAP_CHAIN, engine: "changenow" },
  { slug: "ethereum-to-bitcoin", from: ETHEREUM, to: BITCOIN_PAIR_CHAIN, engine: "changenow" },
  { slug: "bitcoin-to-ethereum", from: BITCOIN_PAIR_CHAIN, to: ETHEREUM, engine: "changenow" },
  { slug: "solana-to-sui", from: SOLANA_SWAP_CHAIN, to: SUI_PAIR_CHAIN, engine: "changenow" },
  { slug: "sui-to-solana", from: SUI_PAIR_CHAIN, to: SOLANA_SWAP_CHAIN, engine: "changenow" },
  { slug: "ethereum-to-sui", from: ETHEREUM, to: SUI_PAIR_CHAIN, engine: "changenow" },
  { slug: "sui-to-ethereum", from: SUI_PAIR_CHAIN, to: ETHEREUM, engine: "changenow" },
  { slug: "bitcoin-to-sui", from: BITCOIN_PAIR_CHAIN, to: SUI_PAIR_CHAIN, engine: "changenow" },
  { slug: "sui-to-bitcoin", from: SUI_PAIR_CHAIN, to: BITCOIN_PAIR_CHAIN, engine: "changenow" },
];

export const SWAP_PAIRS: SwapPair[] = [...RELAY_SWAP_PAIRS, ...CHANGENOW_SWAP_PAIRS];

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
function relayPairCopy(pair: SwapPair): SwapPairCopy {
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

/**
 * BTC/Sui pair copy (2026-08-18) — a genuinely different flow from
 * relayPairCopy above, not just a reworded template: ChangeNOW is a
 * custodial deposit-address exchange, not a wallet-signed bridge, and
 * charges no separate Blockchains.Click platform fee (confirmed against
 * lib/chains/changenow.ts — no feeBps/feeAccount param exists on any
 * ChangeNOW call this app makes). Reusing relayPairCopy's "0.25% platform
 * fee" wording here would be actively wrong, the same class of mistake
 * public/llms.txt had before this session's audit fixed it.
 */
function changeNowPairCopy(pair: SwapPair): SwapPairCopy {
  const { from, to } = pair;
  return {
    intro: `Swap ${from.label} directly into ${to.label} — no wrapped tokens, no manual bridging step. This pair runs through ChangeNOW, a monitored deposit-address exchange, instead of a wallet-signed bridge: there's no separate Blockchains.Click platform fee on it, just ChangeNOW's own live exchange rate.`,
    howItWorks: [
      `Enter how much ${from.label} you want to swap and where to send the ${to.label} — a wallet address on ${to.label}, connected or not.`,
      `Review the live quote — ChangeNOW enforces a minimum tradeable amount for this pair; the page tells you immediately if your amount is too small instead of failing silently.`,
      `Send the exact quoted ${from.label} amount from your own wallet to the deposit address shown. Once it confirms, ${to.label} delivery happens automatically — usually a few minutes.`,
    ],
    faq: [
      {
        question: `What does it cost to swap ${from.label} to ${to.label}?`,
        answer: `No separate Blockchains.Click platform fee on this pair — you pay ChangeNOW's own live exchange rate, shown in the quote before you send anything, plus each network's own transaction fee.`,
      },
      {
        question: `How long does a ${from.label} to ${to.label} swap take?`,
        answer: `Usually a few minutes after your ${from.label} deposit confirms — ChangeNOW settles and delivers automatically once it does, no manual bridging step to wait on separately.`,
      },
      {
        question: `Is this custodial?`,
        answer: `Yes, for this specific pair — you send ${from.label} to a deposit address ChangeNOW controls, and ChangeNOW sends back ${to.label} afterward. The destination address is still locked in at quote time and can't be changed, closing the door on address-swap attacks — that protection works the same as every other pair on this site.`,
      },
      {
        question: `Is there a minimum amount?`,
        answer: `Yes — ChangeNOW enforces a minimum tradeable amount that moves with live rates. Type an amount below it and the quote tells you the exact current minimum instead of just failing.`,
      },
    ],
  };
}

export function swapPairCopy(pair: SwapPair): SwapPairCopy {
  return pair.engine === "changenow" ? changeNowPairCopy(pair) : relayPairCopy(pair);
}
