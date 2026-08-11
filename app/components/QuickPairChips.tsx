import Link from "next/link";
import Image from "next/image";
import { pairForSlug } from "@/lib/content/swapPairs";

// Homepage landing-page redesign (2026-08-11, research-backed — see the plan
// this came from) — reuses SWAP_PAIRS/pairForSlug, already built for the
// /swap/[pair] SEO pages, as real friction-reducing shortcuts (Rango
// Exchange's "quick pair" pattern). Chain-level, not token-level — this
// data is chain-to-chain (SWAP_PAIRS' own doc comment: Solana<->EVM only,
// no token dimension), so these are "Solana → Base" style chips, not
// "SOL → USDC". A curated subset (4 of the real 12 pairs), not all of
// them, to stay a quick scan rather than a wall of chips.
const CURATED_SLUGS = ["solana-to-base", "base-to-solana", "solana-to-arbitrum", "solana-to-ethereum"];

export function QuickPairChips() {
  const pairs = CURATED_SLUGS.map(pairForSlug).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (pairs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {pairs.map((pair) => (
        <Link
          key={pair.slug}
          href={`/swap/${pair.slug}`}
          className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent/40 hover:text-ink"
        >
          <Image src={pair.from.iconUrl} alt="" width={14} height={14} className="rounded-full" />
          <span>{pair.from.label}</span>
          <span aria-hidden="true" className="text-ink-faint">
            →
          </span>
          <Image src={pair.to.iconUrl} alt="" width={14} height={14} className="rounded-full" />
          <span>{pair.to.label}</span>
        </Link>
      ))}
    </div>
  );
}
