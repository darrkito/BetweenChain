import type { FaqData } from "@/lib/content/blog";

// Real bug found 2026-08-24 (SEO/GEO foundation audit): 17 of 28 blog posts
// declare real `faq` frontmatter that feeds a genuine FAQPage JSON-LD block
// (app/blog/[slug]/page.tsx), but that frontmatter was NEVER rendered as
// visible on-page content anywhere — every post's FAQ schema was making a
// claim about content that didn't actually exist on the page. This is the
// same class of bug the site's own SEO/GEO playbooks flag as actively
// harmful (schema-only claims can be discounted/suppressed by Google, and
// AI answer engines lean on visible text far more than schema alone).
//
// Single shared component, reused by every post with `faq` frontmatter
// (app/blog/[slug]/page.tsx) — matches app/faq/page.tsx's existing visual
// pattern (divide-y bordered card list, question as a real heading, answer
// as plain text below it) rather than inventing a new one, so the FAQ
// content-answer-fit pattern is consistent sitewide, not per-page bespoke.
export function FaqSection({ items }: { items: FaqData[] }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <h2 className="font-display text-xl font-semibold text-ink">Frequently asked questions</h2>
      <div className="flex flex-col divide-y divide-hairline rounded-2xl border border-hairline bg-surface shadow-sm">
        {items.map((item) => (
          <div key={item.question} className="flex flex-col gap-2 p-5">
            <h3 className="text-base font-semibold text-ink">{item.question}</h3>
            <p className="max-w-[65ch] text-sm text-ink-muted">{item.answer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
