import Link from "next/link";
import { NFT_CHAIN_FAMILIES } from "@/lib/nft/labels";
import type { NftChainFamily } from "@/lib/nft/types";

// alt="" deliberately — decorative, the chain name text always sits right
// next to this mark, so a screen reader announcing it too would be noise.
function ChainMark({ iconUrl }: { iconUrl: string | null }) {
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external chain-logo host (assets.relay.link), same pattern as TokenIcon/NftImage
      <img src={iconUrl} alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded-full" />
    );
  }
  // No real logo source for this chain yet (see lib/nft/labels.ts) — a plain
  // glyph rather than guessing at an external logo URL.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Chain-family sub-nav — link-based (not local state + onClick) so it renders
 * identically on the browse page (active = whichever tab is selected) and the
 * collection detail page (active = that collection's own chain family, no
 * selection state needed there). Move/Sui is shown disabled rather than
 * hidden so the roadmap stays visible — matches PLAN.md's "don't silently
 * drop deferred scope" instinct already applied elsewhere in this project.
 */
export function NftChainTabs({ active }: { active: NftChainFamily }) {
  return (
    <div className="flex gap-1.5 rounded-2xl border border-hairline bg-surface p-1.5 shadow-sm">
      {NFT_CHAIN_FAMILIES.map((t) => {
        const isActive = t.id === active;

        if (!t.available) {
          return (
            <span
              key={t.id}
              title="Coming soon — pending API access"
              className="flex flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-center text-sm font-medium text-ink-faint"
            >
              <ChainMark iconUrl={t.iconUrl} />
              {t.label}
            </span>
          );
        }
        return (
          <Link
            key={t.id}
            href={`/nft?family=${t.id}`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors ${
              isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-hover hover:text-ink"
            }`}
          >
            <ChainMark iconUrl={t.iconUrl} />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
