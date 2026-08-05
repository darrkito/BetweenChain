// Deliberately NOT "server-only" — shared between client-side display code
// (the collection listings grid) and, if ever needed server-side, the
// purchase routes. Pure data, no secrets — same reasoning as
// lib/nft/tradeportFee.ts.
//
// Real user report 2026-08-05: the listing grid showed Magic Eden's bare
// `price` field, but quoting/buying charges more — confirmed via Magic
// Eden's own published fee model (help.magiceden.io/en/articles/
// 6645652-how-optional-royalties-work-on-magic-eden-s-solana-marketplace):
// the buyer pays List Price + a 2% marketplace taker fee + the creator
// royalty (sellerFeeBasisPoints on the token, default full/100% applied
// unless a buyer explicitly opts down — this app never sends
// buyerCreatorRoyaltyPercent to getMagicEdenBuyInstructions, so Magic
// Eden's default of full royalty is what actually gets charged). Neither
// fee is included in the listings endpoint's raw `price` field — unlike
// the auctionHouse gap (lib/nft/magiceden.ts), this isn't a data-quality
// bug, it's just fees that were never being surfaced to the buyer before
// the "Buy" step.
export const MAGICEDEN_TAKER_FEE_BPS = 200; // 2%, confirmed via ME's published fee docs

// Fallback only for the rare listing whose token data is missing
// sellerFeeBasisPoints entirely — 500 (5%) is the most common Solana
// collection royalty rate (confirmed against real listings, user-verified
// 2026-08-05) and undercharging is worse here than a real dry run at
// buy-instruction time catching a mismatch: this is a SIZING figure for
// quotes/display, not the on-chain authority — getMagicEdenBuyInstructions'
// fresh call right after is what actually determines the real cost.
const MAGICEDEN_ROYALTY_BPS_FALLBACK = 500;

/**
 * The real total a buyer pays for a Magic Eden listing: list price + 2%
 * taker fee + full creator royalty. `royaltyBps` is `sellerFeeBasisPoints`
 * from the listing's own token data.
 */
export function magicEdenBuyerTotal(listingPrice: number, royaltyBps: number | undefined): number {
  const totalBps = MAGICEDEN_TAKER_FEE_BPS + (royaltyBps ?? MAGICEDEN_ROYALTY_BPS_FALLBACK);
  return listingPrice * (1 + totalBps / 10_000);
}
