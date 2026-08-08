import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { Reveal } from "@/app/components/Reveal";
import { HeroVisual } from "@/app/components/HeroVisual";
import { TrustBar } from "@/app/components/TrustBar";
import { NftImage } from "@/app/components/NftImage";
import { JsonLd, faqPageSchema } from "@/lib/seo/jsonld";
import { FAQ_ITEMS } from "@/lib/content/faq";
import { NFT_VENDOR_CLIENTS } from "@/lib/nft/vendorClients";
import { SUI_ICON_URL } from "@/lib/nft/labels";
import { GameCard } from "@/app/components/GameCard";
import { getAllGames } from "@/lib/content/games";

// 2026-08-05 (landing-page overhaul, Phase 2) — `/` used to BE the swap
// tool (now relocated to /swap, see that route's own history). This is a
// real marketing/landing surface: value prop, a wallet-free quote preview,
// feature highlights, an FAQ preview (full FAQ_ITEMS list also powers the
// dedicated /faq page — one data source, two surfaces, same pattern this
// pass uses for breadcrumbs' JSON-LD). Renders its own FAQPage JSON-LD
// (same content as what's visible) since the questions genuinely appear on
// this page too, not just linked to.
export const metadata: Metadata = {
  title: "Blockchains.Click — Cross-Chain Token Swaps & NFT Marketplace",
  description:
    "Swap tokens across Solana, Ethereum, and more in one click. Browse and buy NFTs cross-chain on Solana, EVM chains, and Sui — pay from any supported wallet.",
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    title: "Swap across chains",
    description: "Trade tokens between Solana and EVM chains like Ethereum and Base — including same-chain EVM swaps — with no manual bridging.",
    href: "/swap",
    cta: "Start swapping",
  },
  {
    title: "NFT marketplace",
    description: "Browse and buy NFTs across Solana, EVM chains, and Sui — pay from a different chain than the NFT itself.",
    href: "/nft",
    cta: "Browse NFTs",
  },
  {
    title: "Points & referrals",
    description: "Earn points on every dollar you trade. Refer a friend and both of you get a bonus — 20% for you, 10% for them.",
    href: "/dashboard",
    cta: "View your points",
  },
];

// 2026-08-06 (landing visual pass, real user report: "the page looks the
// same") — fills the large empty gap that used to sit between the features
// grid and the FAQ preview with genuine, live marketplace data (not a
// fabricated stats bar — confirmed this session there's no platform-wide
// aggregate volume/users endpoint to draw from). Server-fetched the same
// way app/nft/page.tsx already does (calls the vendor client directly, no
// HTTP roundtrip to our own /api/nft/collections route). Solana/Magic Eden
// specifically because it's the one vendor with no required `chain` param
// and the deepest, fastest-loading catalog of the three families. Failures
// render nothing (the section just doesn't show) rather than an error
// banner — this is a bonus showcase section, not a page-critical one.
async function getTrendingCollections() {
  try {
    const collections = await NFT_VENDOR_CLIENTS.magiceden.browseCollections();
    return collections.slice(0, 6);
  } catch {
    return [];
  }
}

export default async function LandingPage() {
  const trending = await getTrendingCollections();
  const games = getAllGames().slice(0, 6);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 p-6">
      <AppHeader />

      {/* Hero — not scroll-revealed (already in view on load; animating
          from opacity:0 here would delay the LCP text's first paint).
          2026-08-06: added a soft ambient gradient wash behind the whole
          section (real user report: page felt flat) — a wide, blurred
          radial gradient anchored behind the hero content, purely
          decorative (aria-hidden, absolutely positioned, negative z-index)
          so it never affects layout or the text's first paint. */}
      <section className="relative flex flex-col items-center gap-6 overflow-hidden pt-8 text-center sm:pt-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] opacity-70"
          style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, var(--accent-soft), transparent 70%)" }}
        />
        <HeroVisual />
        <h1 className="max-w-2xl font-display text-4xl font-normal tracking-tight text-ink sm:text-5xl">
          All the blockchains, <span className="text-accent">zero manual bridging.</span>
        </h1>
        <p className="max-w-xl text-base text-ink-muted sm:text-lg">
          Swap tokens and buy NFTs across Solana, Ethereum, and Sui for 0.25% per leg — one destination address,
          locked in and verified on-chain, every time.
        </p>
        <QuotePreviewWidget />
        <TrustBar />
      </section>

      {/* Trending NFT collections — real, live Magic Eden data (see
          getTrendingCollections above), placed right under the swap widget
          (2026-08-06, real user request: "swap, nft trend and then the
          other" — moved above the Features tiles) so it doubles as an
          immediate, genuine trust signal (real floor prices / 24h volume,
          not invented copy) before a visitor even reaches the feature
          list. */}
      {trending.length > 0 && (
        <Reveal className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-normal text-ink">Trending NFT collections</h2>
            <Link href="/nft" className="text-sm font-medium text-accent hover:underline">
              Browse all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {trending.map((c) => (
              <Link
                key={`${c.vendor}-${c.slug}`}
                href={`/nft/${c.vendor}/${encodeURIComponent(c.slug)}`}
                className="group flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg"
              >
                <NftImage src={c.imageUrl} alt={c.name} className="aspect-square w-full rounded-xl" />
                <div className="flex flex-col gap-0.5 px-0.5">
                  <p className="truncate text-xs font-semibold text-ink">{c.name}</p>
                  {c.floorPrice && (
                    <p className="num truncate text-xs text-ink-muted">
                      {c.floorPrice} {c.floorPriceCurrency}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {/* Community Games (2026-08-07) — same "no fetch needed, GAMES is a
          static in-repo array" reasoning as lib/content/games.ts's own doc
          comment, plus the same inline-grid card pattern as Trending NFT
          collections directly above. */}
      {games.length > 0 && (
        <Reveal className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-normal text-ink">🎮 Community Games</h2>
            <Link href="/games" className="text-sm font-medium text-accent hover:underline">
              Browse all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {games.map((g) => (
              <GameCard key={g.slug} game={g} />
            ))}
          </div>
        </Reveal>
      )}

      {/* Dust Sweeper + Portfolio Baskets + ClickPay + Trigger Orders promo
          (2026-08-08) — single-feature cards side by side once there were
          several of these to promote, rather than stacking full-width rows. */}
      <Reveal className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/dust-sweeper"
          className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-6 shadow-sm transition-all hover:border-accent/40"
        >
          <h2 className="font-display text-xl font-normal text-ink">🧹 Dust Sweeper</h2>
          <p className="text-sm text-ink-muted">
            Small stranded token balances add up across chains. Scan your wallets and consolidate them into one
            token in a guided flow.
          </p>
          <span className="mt-1 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            Sweep your dust →
          </span>
        </Link>
        <Link
          href="/basket"
          className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-6 shadow-sm transition-all hover:border-accent/40"
        >
          <h2 className="font-display text-xl font-normal text-ink">🧺 Portfolio Baskets</h2>
          <p className="text-sm text-ink-muted">
            Split one token into a curated basket of destination tokens across chains — one guided flow instead of
            several manual swaps.
          </p>
          <span className="mt-1 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            Browse baskets →
          </span>
        </Link>
        <Link
          href="/pay/create"
          className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-6 shadow-sm transition-all hover:border-accent/40"
        >
          <h2 className="font-display text-xl font-normal text-ink">⚡ ClickPay</h2>
          <p className="text-sm text-ink-muted">
            Create a payment link for the exact token and chain you want to receive — the payer sends whatever they
            hold on any chain.
          </p>
          <span className="mt-1 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            Create a link →
          </span>
        </Link>
        <Link
          href="/orders"
          className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-6 shadow-sm transition-all hover:border-accent/40"
        >
          <h2 className="font-display text-xl font-normal text-ink">⏱️ Trigger Orders</h2>
          <p className="text-sm text-ink-muted">
            Set a Solana price target or a recurring DCA schedule — filled automatically, even while you&apos;re
            offline.
          </p>
          <span className="mt-1 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            Set an order →
          </span>
        </Link>
      </Reveal>

      {/* Features — 2026-08-06 (frontend audit, Impeccable detector:
          "avoid cookie-cutter grids") — replaced the uniform 3-equal-column
          grid with an intentionally asymmetric 7/5 split: the flagship
          feature (swap) gets a wider, taller "hero" card with a bigger
          display-font heading, and the other two stack in the narrower
          column. Same underlying FEATURES data, no reusable abstraction
          needed for a one-off, page-specific split — see FEATURES above. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-12">
        <Reveal className="sm:col-span-7">
          <Link
            href={FEATURES[0].href}
            className="group relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-hairline bg-surface p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-accent-soft opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
            />
            <div className="flex flex-col gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-2xl text-accent">
                <span aria-hidden="true">⇄</span>
              </div>
              <h2 className="font-display text-2xl font-normal text-ink">{FEATURES[0].title}</h2>
              <p className="max-w-md text-sm text-ink-muted">{FEATURES[0].description}</p>
            </div>

            {/* 2026-08-06 — this card sits in the same CSS-grid row as the
                two stacked cards beside it, which stretch it to their combined
                height. A real chain-path visual (real Relay/CoinGecko icon
                URLs, same source app/nft/page.tsx's chain tabs already use —
                see lib/nft/labels.ts) fills that space meaningfully instead
                of leaving dead air between the description and the CTA. */}
            <div className="flex items-center gap-3" aria-hidden="true">
              {[
                { label: "SOL", icon: "https://assets.relay.link/icons/792703809/light.png" },
                { label: "ETH", icon: "https://assets.relay.link/icons/1/light.png" },
                { label: "SUI", icon: SUI_ICON_URL },
              ].map((chain, i, arr) => (
                <div key={chain.label} className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-1.5">
                    <Image src={chain.icon} alt="" width={36} height={36} className="rounded-full ring-4 ring-accent-soft" />
                    <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{chain.label}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <span className="mb-4 text-ink-faint" aria-hidden="true">
                      ⇢
                    </span>
                  )}
                </div>
              ))}
            </div>

            <span className="text-sm font-medium text-accent">
              {FEATURES[0].cta}{" "}
              <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </Link>
        </Reveal>

        <div className="flex flex-col gap-4 sm:col-span-5">
          {FEATURES.slice(1).map((f, i) => (
            <Reveal key={f.title} delay={(i + 1) * 0.08} className="flex-1">
              <Link
                href={f.href}
                className="group relative flex h-full flex-col gap-2 overflow-hidden rounded-2xl border border-hairline bg-surface p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent-soft opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                />
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <span aria-hidden="true" className="text-lg">
                    {i === 0 ? "◆" : "✦"}
                  </span>
                </div>
                <h2 className="text-base font-semibold text-ink">{f.title}</h2>
                <p className="flex-1 text-sm text-ink-muted">{f.description}</p>
                <span className="text-sm font-medium text-accent">
                  {f.cta}{" "}
                  <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ preview */}
      <Reveal className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-normal text-ink">Frequently asked questions</h2>
          <Link href="/faq" className="text-sm font-medium text-accent hover:underline">
            See all →
          </Link>
        </div>
        <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
          {FAQ_ITEMS.slice(0, 4).map((item) => (
            <div key={item.question} className="flex flex-col gap-1.5 p-4">
              <h3 className="text-sm font-semibold text-ink">{item.question}</h3>
              <p className="max-w-[65ch] text-sm text-ink-muted">{item.answer}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <JsonLd data={faqPageSchema(FAQ_ITEMS)} />
    </main>
  );
}
