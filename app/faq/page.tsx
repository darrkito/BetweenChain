import type { Metadata } from "next";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { JsonLd, faqPageSchema, breadcrumbListSchema } from "@/lib/seo/jsonld";
import { FAQ_ITEMS } from "@/lib/content/faq";

const SITE_URL = "https://blockchains.click";

// Title made keyword-specific (2026-08-18, SEO pass) — was the single
// generic word "FAQ", no real target keyword at all. Same lesson already
// applied to /swap's title in an earlier pass (see that route's own
// comment) and the exact pattern the SEO playbook's §15 warns about:
// auditing "the important pages" implicitly skips the ones assumed
// obviously fine. Distinct angle from the homepage title (which already
// leads with "Cross-Chain Token Swaps & NFT Marketplace") to avoid
// title-phrase overlap between sibling pages (playbook §5).
export const metadata: Metadata = {
  title: "Cross-Chain Swap & NFT FAQ: Fees & Security",
  description:
    "Answers to common questions about swapping tokens and buying NFTs across chains on Blockchains.Click — fees, security, points, and supported chains.",
  alternates: { canonical: "/faq" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "FAQ" },
];

export default function FaqPage() {
  return (
    // Widened to match the same max-w-5xl AppHeader convention every other
    // page uses — same fix as the blog pages (real user report: pages
    // using a narrower main rendered a visibly different-width header/nav
    // than the landing/swap/NFT pages).
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Frequently asked questions</h1>
          <p className="text-base text-ink-muted">
            Everything you need to know about swapping and buying NFTs across chains.
          </p>
        </div>

        <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
          {FAQ_ITEMS.map((item) => (
            <div key={item.question} className="flex flex-col gap-2 p-5">
              <h2 className="text-base font-semibold text-ink">{item.question}</h2>
              <p className="max-w-[65ch] text-sm text-ink-muted">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>

      <JsonLd data={faqPageSchema(FAQ_ITEMS)} />
      <JsonLd data={breadcrumbListSchema(BREADCRUMB_ITEMS, `${SITE_URL}/faq`)} />
    </main>
  );
}
