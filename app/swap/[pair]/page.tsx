import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { TrustBar } from "@/app/components/TrustBar";
import { JsonLd, faqPageSchema, breadcrumbListSchema } from "@/lib/seo/jsonld";
import { SWAP_PAIRS, pairForSlug, relatedPairs, swapPairCopy } from "@/lib/content/swapPairs";

const SITE_URL = "https://blockchains.click";

// Bounded, real set (12 Solana<->EVM pairs — see PLAN.md for why not the
// full chain matrix and not token-level pairs) — every page here is
// statically generated at build time, same as app/blog/[slug]/page.tsx.
export function generateStaticParams() {
  return SWAP_PAIRS.map((p) => ({ pair: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const { pair: rawPair } = await params;
  const pair = pairForSlug(rawPair);
  if (!pair) return { title: "Swap", robots: { index: false } };
  const { from, to } = pair;
  // Real gap found live 2026-08-18 (SEO audit, Tier 2): this hardcoded
  // "flat 0.25% fee" for every pair, but that's only true for relay-engine
  // pairs — a changenow pair (BTC/Sui) has no separate platform fee at all
  // (see swapPairCopy/changeNowPairCopy's own doc). A wrong fee claim in
  // the meta description a search result actually displays is worse than
  // an unclear one.
  const description =
    pair.engine === "changenow"
      ? `Swap ${from.label} to ${to.label} directly — no wrapped tokens, no manual bridging, no separate platform fee. Get a live rate before you send anything.`
      : `Swap ${from.label} to ${to.label} for a flat 0.25% fee — no manual bridging. Get a live rate and swap directly, no wallet required to preview.`;
  return {
    title: `Swap ${from.label} to ${to.label}`,
    description,
    alternates: { canonical: `/swap/${pair.slug}` },
  };
}

export default async function SwapPairPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair: rawPair } = await params;
  const pair = pairForSlug(rawPair);
  if (!pair) notFound();

  const { from, to } = pair;
  const copy = swapPairCopy(pair);
  const related = relatedPairs(pair);

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Swap", href: "/swap" },
    { label: `${from.label} to ${to.label}` },
  ];
  const pageUrl = `${SITE_URL}/swap/${pair.slug}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={breadcrumbItems} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            Swap {from.label} to {to.label}
          </h1>
          <p className="max-w-[65ch] text-base text-ink-muted">{copy.intro}</p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <QuotePreviewWidget initialSellChainId={from.chainId} initialBuyChainId={to.chainId} />
          <div className="flex flex-col gap-3 sm:max-w-xs">
            <TrustBar />
            <Link
              href={`/swap?sell=${from.slug}&buy=${to.slug}`}
              className="rounded-xl border border-hairline bg-surface px-4 py-2.5 text-center text-sm font-semibold text-accent transition-all hover:border-accent/40"
            >
              Continue to full swap →
            </Link>
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">How it works</h2>
          <ol className="flex flex-col gap-2">
            {copy.howItWorks.map((step, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
                <span className="num shrink-0 font-semibold text-accent">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Frequently asked questions</h2>
          <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
            {copy.faq.map((item) => (
              <div key={item.question} className="flex flex-col gap-2 p-5">
                <h3 className="text-base font-semibold text-ink">{item.question}</h3>
                <p className="max-w-[65ch] text-sm text-ink-muted">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {related.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-ink">Related swaps</h2>
            <div className="flex flex-wrap gap-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/swap/${r.slug}`}
                  className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
                >
                  {r.from.label} → {r.to.label}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <JsonLd data={faqPageSchema(copy.faq)} />
      <JsonLd data={breadcrumbListSchema(breadcrumbItems, pageUrl)} />
    </main>
  );
}
