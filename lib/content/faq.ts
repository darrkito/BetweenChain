// Single source of truth for FAQ content — reused by the landing page's FAQ
// preview section (app/page.tsx) and the dedicated app/faq/page.tsx, same
// "one source, two outputs" pattern lib/seo/jsonld.tsx's breadcrumbListSchema
// already uses for Breadcrumb.tsx. Every answer here is grounded in this
// app's real, current behavior (fee bps, referral split, supported
// vendors) — verified against lib/fees.ts/lib/points.ts and this session's
// own NFT vendor work, not invented copy.
export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is Blockchains.Click?",
    answer:
      "A cross-chain swap and NFT marketplace — swap tokens between Solana and EVM chains, and browse/buy NFTs across Solana, Ethereum and other EVM chains, and Sui, all from one place.",
  },
  {
    question: "Do I need a wallet to try it?",
    answer:
      "No — you can preview a swap quote right here on this page without connecting anything. You'll need a Solana wallet (and an EVM wallet too, if you're swapping into or out of an EVM chain) to actually execute a swap.",
  },
  {
    question: "What fees does Blockchains.Click charge?",
    answer:
      "A flat 0.25% platform fee, applied on each leg of a swap. There's no separate \"hidden\" fee beyond that plus whatever network/gas fee the underlying chain itself charges.",
  },
  {
    question: "How do points and referrals work?",
    answer:
      "Every dollar of swap volume earns points. Refer a friend and you earn 20% of their swap volume as bonus points, and they get a 10% bonus themselves — both apply automatically once they sign up with your invite.",
  },
  {
    question: "Is it safe? Can the destination address be changed mid-transaction?",
    answer:
      "No — the destination address is locked in the moment you get a quote and cannot be altered afterward, on either the frontend or backend, closing the door on address-swap/MITM attacks. Every buy transaction is also independently re-verified against the real on-chain result before it's ever marked complete, not just trusted from a client-reported hash.",
  },
  {
    question: "Which chains and marketplaces are supported for NFTs?",
    answer:
      "Solana, Ethereum and other EVM chains like Base and ApeChain, and Sui — with the same cross-chain payment flow as token swaps, so you can pay from a different chain than the NFT you're buying.",
  },
  {
    question: "Where can I find your official social channels?",
    answer:
      'Our official X account is @blocksdotclick (linked in the header and footer of every page). We\'ll never DM you first or ask for your seed phrase — if an account claiming to be us does either of those, it isn\'t us.',
  },
];
