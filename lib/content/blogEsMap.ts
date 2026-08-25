// Maps each Spanish blog slug to its English counterpart (and back), for
// hreflang alternates and the language-toggle link on both post pages.
// Real translated Spanish words in the URL itself, not an /es prefix on
// the English slug — the same mistake was made and fixed twice already on
// sibling projects (Luvory, Dizayn), see ~/seo-ai-search-playbook.md §13.
// Not every English post has a Spanish translation yet — only add an
// entry here once content/blog-es/{slug}.mdx actually exists.
export const ES_TO_EN_BLOG_SLUG: Record<string, string> = {
  "limpiar-tokens-basura-wallet-solana": "unlock-crypto-dust-across-chains",
  "ordenes-automaticas-trigger-orders-crypto": "trigger-orders-limit-orders-dca",
  "ganar-dinero-referidos-crypto": "points-and-referrals-explained",
  "comprar-nfts-cross-chain-cualquier-token": "cross-chain-nft-buying-democratized",
  "que-es-un-swap-cross-chain": "how-cross-chain-swaps-work",
  "blockchains-click-vs-uniswap": "blockchains-click-vs-uniswap",
  "mejor-wallet-swap-cross-chain-phantom-metamask": "best-wallet-cross-chain-swap-phantom-metamask",
  "revocar-aprobaciones-tokens-seguridad-crypto": "revoke-token-approvals-crypto-security",
};

export const EN_TO_ES_BLOG_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(ES_TO_EN_BLOG_SLUG).map(([es, en]) => [en, es])
);
