import { tierForBalance } from "@/lib/tiers";

// Display-only status badge next to the points balance — see lib/tiers.ts's
// doc comment for why this is deliberately not tied to any perk yet.
export function TierBadge({ balance }: { balance: number | null }) {
  if (balance === null) return null;
  const tier = tierForBalance(balance);
  return (
    <span className="w-fit rounded-full border border-hairline bg-surface-hover px-3 py-1 text-xs font-semibold text-accent">
      {tier.name} tier
    </span>
  );
}
