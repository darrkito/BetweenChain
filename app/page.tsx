import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { Reveal } from "@/app/components/Reveal";
import { HeroVisual } from "@/app/components/HeroVisual";
import { NftImage } from "@/app/components/NftImage";
import { JsonLd, faqPageSchema } from "@/lib/seo/jsonld";
import { FAQ_ITEMS } from "@/lib/content/faq";
import { NFT_VENDOR_CLIENTS } from "@/lib/nft/vendorClients";

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
    description: "Trade meme coins and tokens starting from Solana into assets on Ethereum, Base, and more — no manual bridging.",
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
    href: "/faq",
    cta: "How it works",
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
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          All the blockchains, <span className="text-accent">in just one click.</span>
        </h1>
        <p className="max-w-xl text-base text-ink-muted sm:text-lg">
          Swap tokens and buy NFTs across Solana, Ethereum, and Sui — one destination address, locked in and
          verified on-chain, every time.
        </p>
        <QuotePreviewWidget />
      </section>

      {/* Features — 2026-08-06: added real depth (layered gradient
          background + stronger shadow-on-hover + an accent-tinted icon
          chip) in place of the previous flat white-bordered box, per real
          user feedback that cards/sections looked flat. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.08}>
            <Link
              href={f.href}
              className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-hairline bg-surface p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent-soft opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              />
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <span aria-hidden="true" className="text-lg">
                  {i === 0 ? "⇄" : i === 1 ? "◆" : "✦"}
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
      </section>

      {/* Trending NFT collections — real, live Magic Eden data (see
          getTrendingCollections above), fills what used to be a large empty
          gap before the FAQ preview and doubles as a genuine trust signal
          (real floor prices / 24h volume, not invented copy). */}
      {trending.length > 0 && (
        <Reveal className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-ink">Trending NFT collections</h2>
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

      {/* FAQ preview */}
      <Reveal className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-ink">Frequently asked questions</h2>
          <Link href="/faq" className="text-sm font-medium text-accent hover:underline">
            See all →
          </Link>
        </div>
        <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
          {FAQ_ITEMS.slice(0, 4).map((item) => (
            <div key={item.question} className="flex flex-col gap-1.5 p-4">
              <h3 className="text-sm font-semibold text-ink">{item.question}</h3>
              <p className="text-sm text-ink-muted">{item.answer}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <JsonLd data={faqPageSchema(FAQ_ITEMS)} />
    </main>
  );
}
