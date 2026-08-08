import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";

interface Props {
  searchParams: Promise<{ amount?: string; count?: string }>;
}

function parseAmount(raw: string | undefined): string {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : "0.00";
}

function parseCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { amount, count } = await searchParams;
  const amountUsd = parseAmount(amount);
  const tokenCount = parseCount(count);
  const title = `I just unlocked $${amountUsd} of dead crypto dust`;
  const imageUrl = `/api/dust-sweeper/share-image?amount=${amountUsd}&count=${tokenCount}`;
  return {
    title,
    description: `Recovered value from ${tokenCount} stranded token${tokenCount === 1 ? "" : "s"} across chains using the Dust Sweeper.`,
    openGraph: { images: [imageUrl] },
    twitter: { card: "summary_large_image", images: [imageUrl] },
  };
}

export default async function DustSweeperSharePage({ searchParams }: Props) {
  const { amount, count } = await searchParams;
  const amountUsd = parseAmount(amount);
  const tokenCount = parseCount(count);
  const intentText = `I just unlocked $${amountUsd} of dead crypto dust using @BlockchainsClick 🧹`;
  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(intentText)}&url=${encodeURIComponent("https://blockchains.click/dust-sweeper")}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">🧹 Dust Recovered</p>
        <p className="num font-display text-6xl font-semibold text-ink">${amountUsd}</p>
        <p className="text-sm text-ink-muted">
          unlocked from {tokenCount} stranded token{tokenCount === 1 ? "" : "s"} across chains
        </p>
        <div className="mt-4 flex gap-3">
          <a
            href={intentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Share on X
          </a>
          <Link
            href="/dust-sweeper"
            className="rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold text-ink-muted transition-all hover:border-accent/40 hover:text-accent"
          >
            Try the Dust Sweeper
          </Link>
        </div>
      </div>
    </main>
  );
}
