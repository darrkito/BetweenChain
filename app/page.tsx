import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { TrendingBar } from "@/app/components/TrendingBar";
import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { JsonLd, faqPageSchema } from "@/lib/seo/jsonld";
import { FAQ_ITEMS } from "@/lib/content/faq";
import { SOLANA_CHAIN_ID_CLIENT } from "@/lib/client/constants";

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
    "Swap tokens across Solana, Ethereum, and more in one click. Browse and buy NFTs cross-chain on Magic Eden, OpenSea, and Tradeport — pay from any supported wallet.",
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

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 p-6">
      <AppHeader />

      {/* Hero */}
      <section className="flex flex-col items-center gap-6 pt-8 text-center sm:pt-14">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          All the blockchains, <span className="text-accent">in just one click.</span>
        </h1>
        <p className="max-w-xl text-base text-ink-muted sm:text-lg">
          Swap tokens and buy NFTs across Solana, Ethereum, and Sui — one destination address, locked in and
          verified on-chain, every time.
        </p>
        <QuotePreviewWidget />
      </section>

      <TrendingBar chainId={SOLANA_CHAIN_ID_CLIENT} />

      {/* Features */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="group flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg"
          >
            <h2 className="text-base font-semibold text-ink">{f.title}</h2>
            <p className="flex-1 text-sm text-ink-muted">{f.description}</p>
            <span className="text-sm font-medium text-accent">
              {f.cta} <span aria-hidden="true">→</span>
            </span>
          </Link>
        ))}
      </section>

      {/* FAQ preview */}
      <section className="flex flex-col gap-4">
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
      </section>

      <JsonLd data={faqPageSchema(FAQ_ITEMS)} />
    </main>
  );
}
