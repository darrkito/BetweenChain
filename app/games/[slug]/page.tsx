import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { GamePlayer } from "@/app/components/GamePlayer";
import { getAllGames, getGame } from "@/lib/content/games";
import { JsonLd, breadcrumbListSchema, videoGameSchema } from "@/lib/seo/jsonld";

export function generateStaticParams() {
  return getAllGames().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) return {};
  return {
    title: game.name,
    description: game.description,
    alternates: { canonical: `/games/${game.slug}` },
    openGraph: { images: game.coverImage ? [game.coverImage] : undefined },
  };
}

function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default async function GameDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();

  const breadcrumbItems = [{ label: "Games", href: "/games" }, { label: game.name }];
  const pageUrl = `https://blockchains.click/games/${game.slug}`;

  const socialLinks = [
    game.website ? { label: "Website", url: sanitizeUrl(game.website) } : null,
    game.twitterUsername ? { label: "X", url: sanitizeUrl(`https://x.com/${game.twitterUsername}`) } : null,
    game.discordUrl ? { label: "Discord", url: sanitizeUrl(game.discordUrl) } : null,
    game.telegramUrl ? { label: "Telegram", url: sanitizeUrl(game.telegramUrl) } : null,
  ].filter((l): l is { label: string; url: string } => Boolean(l?.url));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <Breadcrumb items={breadcrumbItems} />

      <div>
        <h1 className="font-display text-2xl font-normal text-ink sm:text-3xl">{game.name}</h1>
        <p className="text-sm text-ink-muted">
          By {game.developer} · {game.genre}
        </p>
      </div>

      <GamePlayer game={game} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm md:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Overview</h2>
          <p className="text-sm text-ink-muted">{game.description}</p>
          {game.gameplay && (
            <>
              <h3 className="mt-2 text-sm font-semibold text-ink">Gameplay</h3>
              <p className="text-sm text-ink-muted">{game.gameplay}</p>
            </>
          )}
          {game.controls && (
            <>
              <h3 className="mt-2 text-sm font-semibold text-ink">Controls</h3>
              <p className="text-sm text-ink-muted">{game.controls}</p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Details</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">Developer</dt>
              <dd className="text-ink">{game.developer}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-faint">Genre</dt>
              <dd className="text-ink">{game.genre}</dd>
            </div>
            {game.nftCollection && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-faint">NFT collection</dt>
                <dd>
                  <a href={`/nft/${game.nftCollection.vendor}/${encodeURIComponent(game.nftCollection.slug)}`} className="text-accent hover:underline">
                    View →
                  </a>
                </dd>
              </div>
            )}
            {game.tokenMint && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-faint">Token</dt>
                <dd>
                  {/* Reuses the same ?radarMint=&radarUsd= prefill mechanism
                      built for the Meme Radar's quick-buy chips
                      (app/swap/SwapPageClient.tsx) — resolves the specific
                      token via /api/tokens/list, same as pasting its
                      address, and pre-fills a modest $10 default amount
                      rather than an empty/zero one. */}
                  <a href={`/swap?radarMint=${encodeURIComponent(game.tokenMint)}&radarUsd=10`} className="text-accent hover:underline">
                    Swap →
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {socialLinks.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2 border-t border-hairline pt-3">
              {socialLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-hairline px-3 py-1 text-xs text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
                >
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </section>
      </div>

      {game.screenshots && game.screenshots.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-ink">Screenshots</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {game.screenshots.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element -- external, game-team-hosted screenshots
              <img key={src} src={src} alt={`${game.name} screenshot`} className="aspect-video w-full rounded-xl object-cover" />
            ))}
          </div>
        </section>
      )}

      <JsonLd data={breadcrumbListSchema(breadcrumbItems, pageUrl)} />
      <JsonLd
        data={videoGameSchema({
          slug: game.slug,
          name: game.name,
          description: game.description,
          developer: game.developer,
          genre: game.genre,
          coverImage: game.coverImage,
          website: game.website,
          twitterUsername: game.twitterUsername,
          discordUrl: game.discordUrl,
          telegramUrl: game.telegramUrl,
        })}
      />
    </main>
  );
}
