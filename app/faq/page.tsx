import type { Metadata } from "next";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { JsonLd, faqPageSchema, breadcrumbListSchema } from "@/lib/seo/jsonld";
import { FAQ_ITEMS } from "@/lib/content/faq";

const SITE_URL = "https://blockchains.click";

export const metadata: Metadata = {
  title: "FAQ",
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <AppHeader />
      <Breadcrumb items={BREADCRUMB_ITEMS} />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Frequently asked questions</h1>
        <p className="text-base text-ink-muted">
          Everything you need to know about swapping and buying NFTs across chains.
        </p>
      </div>

      <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
        {FAQ_ITEMS.map((item) => (
          <div key={item.question} className="flex flex-col gap-2 p-5">
            <h2 className="text-base font-semibold text-ink">{item.question}</h2>
            <p className="text-sm text-ink-muted">{item.answer}</p>
          </div>
        ))}
      </div>

      <JsonLd data={faqPageSchema(FAQ_ITEMS)} />
      <JsonLd data={breadcrumbListSchema(BREADCRUMB_ITEMS, `${SITE_URL}/faq`)} />
    </main>
  );
}
