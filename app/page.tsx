import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { QuickPairChips } from "@/app/components/QuickPairChips";
import { RecentPairChips } from "@/app/components/RecentPairChips";
import { Reveal } from "@/app/components/Reveal";
import { TrustBar } from "@/app/components/TrustBar";
import { StatsBar } from "@/app/components/StatsBar";
import { NftImage } from "@/app/components/NftImage";
import { JsonLd, faqPageSchema } from "@/lib/seo/jsonld";
import { FAQ_ITEMS } from "@/lib/content/faq";
import { NFT_VENDOR_CLIENTS } from "@/lib/nft/vendorClients";
import { SUI_ICON_URL } from "@/lib/nft/labels";
import { MORE_TOOLS } from "@/lib/content/moreTools";

// 2026-08-05 (landing-page overhaul, Phase 2) — `/` used to BE the swap
// tool (now relocated to /swap, see that route's own history). This is a
// real marketing/landing surface: value prop, a wallet-free quote preview,
// feature highlights, an FAQ preview (full FAQ_ITEMS list also powers the
// dedicated /faq page — one data source, two surfaces, same pattern this
// pass uses for breadcrumbs' JSON-LD). Renders its own FAQPage JSON-LD
// (same content as what's visible) since the questions genuinely appear on
// this page too, not just linked to.
// Flipped to keyword-first (2026-08-18, SEO pass) — was brand-first
// ("Blockchains.Click — ..."), the exact pattern a prior audit on a
// different project (Luvory) found no real competitor uses and fixed with
// a measurable ranking improvement (see the SEO playbook's §15). This page
// sits at the same layout level as app/layout.tsx's title template, so it
// doesn't inherit the automatic " | Blockchains.Click" suffix every deeper
// page gets — added explicitly here instead, same net brand visibility,
// just reordered.
export const metadata: Metadata = {
  title: "Cross-Chain Token Swaps & NFT Marketplace | Blockchains.Click",
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

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 p-6">
      <AppHeader />

      {/* Hero — not scroll-revealed (already in view on load; animating
          from opacity:0 here would delay the LCP text's first paint).
          2026-08-12 (de-generic-ify pass): un-centered — copy now anchors
          left against a real functional focal point (the quote widget) on
          the right, instead of stacking everything centered above it. The
          ambient radial-gradient glow div and the abstract HeroVisual mark
          (which carried its own blur-2xl glow) are both gone — two glow
          sources competing with the widget for attention worked against
          the "one clear goal" principle the 2026-08-11 redesign already
          established. See PLAN.md's "de-AI-ify" entry for the full audit. */}
      <section className="flex flex-col gap-10 pt-8 sm:pt-14">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-14">
          <div className="flex flex-col gap-5">
            <h1 className="max-w-xl font-display text-4xl font-normal tracking-tight text-ink sm:text-5xl">
              All the blockchains, <span className="text-accent">zero manual bridging.</span>
            </h1>
            <p className="max-w-lg text-base text-ink-muted sm:text-lg">
              Swap tokens and buy NFTs across Solana, Ethereum, and Sui — no bridging, no manual steps, ever.
            </p>
            {/* Real security trust line (2026-08-11, homepage redesign) — this
                claim is already true and already shipped (the destination-
                address-lock + on-chain re-verification behavior this links to),
                just previously buried in a blog post nobody reached from here. */}
            <p className="max-w-md text-xs text-ink-faint">
              🔒 Destination address locked at quote time, re-verified on-chain before every swap completes.{" "}
              <Link href="/blog/swap-security-101" className="font-medium text-accent hover:underline">
                How it works →
              </Link>
            </p>
            {/* Real, verifiable wallet-support line, text-only (2026-08-11) —
                deliberately NOT a logo row: this app has no static wallet-logo
                list anywhere (Solana wallets come from live Wallet Standard
                auto-detection, EVM from live EIP-6963 discovery — both runtime-
                only, see app/providers.tsx / lib/client/EvmWalletProvider.tsx),
                and TrustBar.tsx's own doc comment already establishes "never
                fabricate a logo" as a hard rule for this codebase. Every name
                below is genuinely supported since Wallet Standard/EIP-6963 are
                exactly the protocols these wallets implement — same "real text
                badge" pattern TrustBar uses for Jupiter/Relay. */}
            <p className="max-w-md text-xs text-ink-faint">
              Works with Phantom, Solflare, MetaMask, Rabby, Coinbase Wallet, and any Wallet Standard / EIP-6963 wallet.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3 lg:items-end">
            <QuotePreviewWidget />
            <QuickPairChips />
            {/* Renders nothing for first-time visitors (no localStorage
                entries yet) — only returning users who've completed a swap
                see this, one-click back into a pair they've actually used
                (2026-08-18 retention pass — see RecentPairChips.tsx). */}
            <RecentPairChips />
          </div>
        </div>
        <div className="flex flex-col items-center gap-4">
          <TrustBar />
          <StatsBar />
        </div>
      </section>

      {/* Features — MOVED UP (2026-08-11 homepage redesign) — right after the
          interactive hero widget, before any other content, so a first-time
          visitor knows what this product actually IS before seeing NFT
          proof-of-life content or secondary tools. 2026-08-06 (frontend
          audit, Impeccable detector:
          "avoid cookie-cutter grids") — replaced the uniform 3-equal-column
          grid with an intentionally asymmetric 7/5 split: the flagship
          feature (swap) gets a wider, taller "hero" card with a bigger
          display-font heading, and the other two stack in the narrower
          column. Same underlying FEATURES data, no reusable abstraction
          needed for a one-off, page-specific split — see FEATURES above.
          2026-08-12 (de-generic-ify pass): floating rounded-2xl cards with a
          blur-2xl hover-glow blob replaced with the gap-px structural-grid
          technique — the container's own bg-hairline shows through 1px
          gaps as real dividers (no doubled borders), cells sit flush with
          sharp corners instead of floating with a shadow. See PLAN.md's
          "de-AI-ify" entry. The 5-col column nests its own gap-px
          sub-grid (grid-rows-2) so the divider between its two stacked
          cards is real too, not just a flex gap. */}
      <section className="grid grid-cols-1 gap-px border border-hairline bg-hairline sm:grid-cols-12">
        <Reveal className="sm:col-span-7">
          <Link
            href={FEATURES[0].href}
            className="group flex h-full flex-col justify-between gap-6 bg-surface p-7 transition-colors duration-100 hover:bg-surface-hover"
          >
            {/* 2026-08-12 (de-generic-ify pass): the rounded-xl bg-accent-soft
                icon box is gone — replaced with a monospace index tag (this
                app's own JetBrains Mono / --ink-faint tokens, already used
                for numeric data elsewhere via the `.num` utility) plus the
                same glyph rendered inline instead of boxed. See PLAN.md's
                "de-AI-ify" entry. */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-ink-faint">[01]</span>
                <span aria-hidden="true" className="text-lg text-accent">
                  ⇄
                </span>
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

        <div className="grid grid-rows-2 gap-px bg-hairline sm:col-span-5">
          {FEATURES.slice(1).map((f, i) => (
            <Reveal key={f.title} delay={(i + 1) * 0.08}>
              <Link
                href={f.href}
                className="group flex h-full flex-col gap-2 bg-surface p-5 transition-colors duration-100 hover:bg-surface-hover"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-ink-faint">{i === 0 ? "[02]" : "[03]"}</span>
                  <span aria-hidden="true" className="text-lg text-accent">
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

      {/* Trending NFT collections — MOVED (2026-08-11 homepage redesign) to
          right after Features, so it now makes contextual sense: Features
          just told the visitor this is an NFT marketplace, this proves that
          claim with real, live Magic Eden data (real floor prices, not
          invented copy) before FAQ/objection-handling. */}
      {trending.length > 0 && (
        <Reveal className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-normal text-ink">Trending NFT collections</h2>
            <Link href="/nft" className="text-sm font-medium text-accent hover:underline">
              Browse all →
            </Link>
          </div>
          {/* 2026-08-12 (de-generic-ify pass): same gap-px structural-grid
              treatment as Features/More tools above — see PLAN.md's
              "de-AI-ify" entry. NftImage keeps its own rounded-xl (photo
              corner treatment, not container chrome — distinct concern). */}
          <div className="grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-3 md:grid-cols-6">
            {trending.map((c) => (
              <Link
                key={`${c.vendor}-${c.slug}`}
                href={`/nft/${c.vendor}/${encodeURIComponent(c.slug)}`}
                className="group flex flex-col gap-2 bg-surface p-2.5 transition-colors duration-100 hover:bg-surface-hover"
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

      {/* FAQ preview — MOVED UP (2026-08-11) closer to the decision point,
          right after proof-of-life content, instead of dead last after
          several more feature pitches (objection-handling belongs near
          where the visitor is actually deciding, per the research this
          redesign is based on). */}
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

      {/* "More tools" (2026-08-11 homepage redesign) — Dust Sweeper,
          Baskets, ClickPay, Trigger Orders, and Games, consolidated from
          5 equal-weight full promo cards into one clearly-secondary row:
          icon + one-line label only, the whole tile is the link, no
          competing full CTA button. "Every converting landing page has one
          clear goal" — these are real, still-reachable features, just no
          longer competing with the primary swap CTA for a first-time
          visitor's attention. */}
      <Reveal className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-normal text-ink">More tools</h2>
        {/* 2026-08-12 (de-generic-ify pass): same gap-px structural-grid
            treatment as the Features section above — see PLAN.md's
            "de-AI-ify" entry. Base 3 cols, not 2 (real bug caught via a
            live Playwright screenshot): 5 MORE_TOOLS items over 2 columns
            leaves the last cell alone with an awkward bare bg-hairline gap
            beside it — far more visible than under the old floating-card
            treatment, where empty space just blended into the page
            background. 3 columns gives a normal 3+2 last row instead. */}
        <div className="grid grid-cols-3 gap-px border border-hairline bg-hairline sm:grid-cols-5">
          {MORE_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex flex-col items-center gap-2 bg-surface px-3 py-5 text-center transition-colors duration-100 hover:bg-surface-hover"
            >
              <span aria-hidden="true" className="text-2xl">
                {tool.icon}
              </span>
              <span className="text-xs font-medium text-ink-muted">{tool.label}</span>
            </Link>
          ))}
        </div>
      </Reveal>

      <JsonLd data={faqPageSchema(FAQ_ITEMS)} />
    </main>
  );
}
