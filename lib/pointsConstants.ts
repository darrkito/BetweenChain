// Shared points/referral constants — deliberately NOT server-only (unlike
// lib/points.ts, which owns the actual crediting logic and DB writes and
// must stay server-side). This file exists so client components (e.g. the
// dashboard's points calculator) can compute the same real numbers instead
// of hardcoding a second, driftable copy — same "explicitly shared registry"
// pattern already used by lib/nft/evmChains.ts.
export const REFERRER_SHARE = 0.2; // 20% of referred user's volume, as points, to the referrer
export const REFERRED_BONUS = 0.1; // 10% bonus, as points, to the referred user themselves
