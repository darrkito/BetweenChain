// Deliberately NOT "server-only" — this constant needs to be shared between
// server-side purchase routes (lib/chains/sui.ts, the Sui purchase API
// routes) AND client-side display code (the collection listings grid,
// NftBuyModalSui.tsx), so both show/charge the same number. Pure data, no
// secrets, safe either side of the boundary — same reasoning as
// lib/nft/evmChains.ts's shared chain list.
//
// Real, observed overhead on top of raw Tradeport listing price (see
// lib/chains/sui.ts's dryRunSuiTransactionCostMist doc: 0.8825/9 ≈ 9.806%,
// confirmed against a real completed transaction — and separately
// corroborated live 2026-07-22 against Tradeport's own website showing
// "Buy 9.9 SUI" for a 9 SUI listing, exactly matching this 10% margin).
// This is a DISPLAY/SIZING estimate, not the authoritative cost — the real
// dry run (lib/nft/tradeportBuy.ts's buildVerifiedTradeportBuyTransaction),
// run right before a signature is requested, always wins when it can
// succeed. 10% (2026-07-22, user decision, tightened from an initial 20%)
// tracks the real data point closely rather than padding generously — an
// exact-simulation "probe" wallet (a well-funded address used purely for
// dry-running, no private key/signing involved) would replace this with a
// live number for any collection's real fee, not built yet.
export const TRADEPORT_FEE_SAFETY_MARGIN = 0.1;

// Extra buffer ON TOP of TRADEPORT_FEE_SAFETY_MARGIN, applied ONLY when
// sizing how much to bridge for a cross-chain (ETH/SOL) purchase — user
// requirement 2026-07-22: a cross-chain buyer trusted the app to convert
// their ETH/SOL into "enough" SUI; discovering a shortfall AFTER the bridge
// already ran is unacceptable, not just an inconvenience, since by that
// point they've already committed real funds through a conversion they
// can't easily undo. This 1% is deliberately separate from the Tradeport
// fee margin above (which tracks a real, known number) — it exists purely
// to absorb residual estimation error / rate movement between quote and
// bridge settlement, making the cross-chain "insufficient_funds" path an
// exceptional safety net rather than a routine occurrence. Any leftover
// SUI beyond the real cost simply stays in the buyer's own wallet, same as
// the existing "never lost" reasoning elsewhere in this app — this is not
// a fee charged anywhere, just extra headroom before bridging.
export const CROSS_CHAIN_BRIDGE_BUFFER = 0.01;
