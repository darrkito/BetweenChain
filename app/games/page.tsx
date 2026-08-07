import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { GameCard } from "@/app/components/GameCard";
import { GameCategoryTabs } from "@/app/components/GameCategoryTabs";
import { GameSearchBar } from "@/app/components/GameSearchBar";
import { getAllGames, type GameMeta } from "@/lib/content/games";
import { getPlayCounts } from "@/lib/games/plays";

type GamesSearchParams = { category?: string; genre?: string; q?: string; sort?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<GamesSearchParams> }): Promise<Metadata> {
  const params = await searchParams;
  const title = params.q ? `"${params.q}" — Games` : "Community Games";
  return {
    title,
    description: "Play browser games built by Web3 communities, NFT collections, and token ecosystems — right on Blockchains.Click.",
    alternates: { canonical: "/games" },
  };
}

const SORT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "newest", label: "Newest" },
  { id: "az", label: "A–Z" },
  { id: "popular", label: "Most Popular" },
];

function sortGames(games: GameMeta[], sort: string, playCounts: Record<string, number>): GameMeta[] {
  const sorted = [...games];
  if (sort === "az") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === "popular") {
    sorted.sort((a, b) => (playCounts[b.slug] ?? 0) - (playCounts[a.slug] ?? 0));
  } else {
    sorted.sort((a, b) => b.addedDate.localeCompare(a.addedDate));
  }
  return sorted;
}

// Server component — reads GAMES directly (a static in-repo array, see
// lib/content/games.ts's doc comment for why there's no admin/DB layer for
// this yet), same "no HTTP round-trip to our own API for data this process
// already has" principle as app/page.tsx's getTrendingCollections() and
// app/nft/page.tsx's direct vendor-client calls.
export default async function GamesIndexPage({ searchParams }: { searchParams: Promise<GamesSearchParams> }) {
  const params = await searchParams;
  const category = params.category ?? "all";
  const genre = params.genre;
  const query = params.q?.trim().toLowerCase();
  const sort = params.sort ?? "newest";

  let games = getAllGames();
  if (category !== "all") games = games.filter((g) => g.category === category);
  if (genre) games = games.filter((g) => g.genre.toLowerCase() === genre.toLowerCase());
  if (query) games = games.filter((g) => g.name.toLowerCase().includes(query) || g.developer.toLowerCase().includes(query));

  const playCounts = await getPlayCounts();
  games = sortGames(games, sort, playCounts);

  const genres = Array.from(new Set(getAllGames().map((g) => g.genre))).sort();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <h1 className="font-display px-1 text-2xl font-normal text-ink sm:text-3xl">🎮 Community Games</h1>
      <p className="px-1 text-sm text-ink-muted">
        Browser games built by Web3 communities, NFT collections, and token ecosystems — play right here, no download.
      </p>
      <Breadcrumb items={[{ label: "Games" }]} />

      <GameCategoryTabs active={category} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <GameSearchBar category={category !== "all" ? category : undefined} genre={genre} initialQuery={query} />
        <div className="flex flex-wrap gap-1.5">
          {SORT_OPTIONS.map((s) => {
            const activeSort = s.id === sort;
            const linkParams = new URLSearchParams();
            if (category !== "all") linkParams.set("category", category);
            if (genre) linkParams.set("genre", genre);
            if (query) linkParams.set("q", query);
            if (s.id !== "newest") linkParams.set("sort", s.id);
            const qs = linkParams.toString();
            return (
              <Link
                key={s.id}
                href={qs ? `/games?${qs}` : "/games"}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeSort ? "border-accent bg-accent-soft text-accent" : "border-hairline text-ink-muted hover:bg-surface-hover"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      {genres.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {genres.map((g) => {
            const active = genre?.toLowerCase() === g.toLowerCase();
            const linkParams = new URLSearchParams();
            if (category !== "all") linkParams.set("category", category);
            if (query) linkParams.set("q", query);
            if (!active) linkParams.set("genre", g);
            const qs = linkParams.toString();
            return (
              <Link
                key={g}
                href={qs ? `/games?${qs}` : "/games"}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active ? "bg-accent text-accent-ink" : "bg-surface-hover text-ink-muted hover:text-ink"
                }`}
              >
                {g}
              </Link>
            );
          })}
        </div>
      )}

      {games.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-hairline py-16 text-center">
          <p className="text-sm font-medium text-ink">No games found</p>
          <p className="text-sm text-ink-muted">Try a different search or filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {games.map((g) => (
            <GameCard key={g.slug} game={g} playCount={playCounts[g.slug]} />
          ))}
        </div>
      )}
    </main>
  );
}
