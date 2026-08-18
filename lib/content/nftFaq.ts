// NFT-marketplace-specific FAQ (2026-08-18, SEO Tier 2) — deliberately a
// DIFFERENT set of questions from lib/content/faq.ts's site-wide FAQ_ITEMS
// (which already has a broader "which chains/marketplaces are supported"
// question) rather than duplicating it verbatim on /nft — same
// sibling-page title/content-overlap concern the SEO playbook's §5 flags
// for cannibalization, applied here to FAQ content instead of titles.
// Every answer is grounded in this app's real, current behavior — verified
// against lib/fees.ts and this session's own NFT vendor/ChangeNOW work,
// not invented copy.
export interface FaqItem {
  question: string;
  answer: string;
}

export const NFT_FAQ_ITEMS: FaqItem[] = [
  {
    question: "Can I buy a Solana NFT with ETH, or an Ethereum NFT with SOL?",
    answer:
      "Yes — pick any collection, then pay with a token from a different chain than the NFT itself. The cross-chain leg happens automatically as part of the purchase; you don't need to bridge or swap first.",
  },
  {
    question: "Can I pay for an NFT with Bitcoin or Sui?",
    answer:
      "Yes for a Sui NFT specifically — BTC, SOL, ETH (including several L2s), or SUI itself can all pay for a Sui NFT, via the same ChangeNOW-backed flow this app's BTC/Sui token swaps use. Solana and EVM NFTs currently accept SOL or ETH.",
  },
  {
    question: "Which marketplaces do these listings come from?",
    answer:
      "Real, live listings pulled directly from each chain's own marketplace — Magic Eden for Solana, OpenSea and Tradeport depending on the EVM/Sui collection — not a static or cached copy. Floor price, volume, and individual listings all reflect the source marketplace in real time.",
  },
  {
    question: "What fees apply to a cross-chain NFT purchase?",
    answer:
      "The same 0.25% platform fee per leg that applies to token swaps, plus each network's own gas fee. A same-chain purchase (paying in the NFT's own native token) has no cross-chain leg at all, so no platform fee applies.",
  },
];
