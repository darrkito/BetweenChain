// Display-only tier classification (2026-08-06 UX audit pass). Deliberately
// NOT tied to any perk or fee discount — no schema change, no migration,
// purely a client-side bucketing of the `balance` value GET /api/points
// already returns. Thresholds are against POINTS BALANCE specifically, not
// raw trading volume — balance includes referral bonus points on top of
// floor(volume), so it's a close but not exact proxy (see lib/points.ts).
// UI copy should say "points balance," never "trading volume," to avoid
// overclaiming precision this doesn't have.
export interface Tier {
  name: string;
  minBalance: number;
}

export const TIERS: Tier[] = [
  { name: "Bronze", minBalance: 0 },
  { name: "Silver", minBalance: 1_000 },
  { name: "Diamond", minBalance: 10_000 },
];

export function tierForBalance(balance: number): Tier {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (balance >= tier.minBalance) current = tier;
  }
  return current;
}
