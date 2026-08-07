import Link from "next/link";
import type { GameMeta } from "@/lib/content/games";

const CATEGORY_LABEL: Record<GameMeta["category"], string> = {
  token: "Token",
  "nft-collection": "NFT Collection",
  community: "Community",
};

// Same card visual language as every other grid card in this app
// (rounded-2xl/border-hairline/shadow-sm, hover-lift, accent-soft badge
// pill) — see NftCollectionsGrid.tsx / the homepage trending-collections
// section for the established convention this matches.
export function GameCard({ game, playCount }: { game: GameMeta; playCount?: number }) {
  return (
    <Link
      href={`/games/${game.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-accent/40 hover:shadow-lg"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-surface-hover">
        {/* eslint-disable-next-line @next/next/no-img-element -- external, game-team-hosted cover images, same reasoning as TokenIcon/NftImage elsewhere in this app */}
        <img
          src={game.coverImage}
          alt={game.name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <span className="absolute left-2 top-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
          {CATEGORY_LABEL[game.category]}
        </span>
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="font-display truncate text-sm font-normal text-ink group-hover:text-accent">{game.name}</p>
        <p className="truncate text-xs text-ink-faint">{game.genre}</p>
        <div className="mt-1 flex items-center justify-between border-t border-hairline pt-2">
          <span className="text-xs text-ink-muted">{game.developer}</span>
          {playCount != null && playCount > 0 && (
            <span className="num text-xs text-ink-faint">{playCount.toLocaleString()} plays</span>
          )}
        </div>
      </div>
    </Link>
  );
}
