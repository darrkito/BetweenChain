import Link from "next/link";

// 2026-08-06 (blog enrichment pass) — reusable pieces blog posts reference
// declaratively from their own .mdx body via next-mdx-remote/rsc's
// `components` prop (app/blog/[slug]/page.tsx). Both are plain Server
// Components — no interactivity needed, just links/static SVG — so no
// "use client" required even though this app's MDX runs through an RSC
// pipeline.
//
// StatBar/QuickFacts take their structured data as a JSON-STRING prop
// (parsed internally), not a JS array/object-literal expression attribute
// (`items={[...]}`) — confirmed live this MDX pipeline (next-mdx-remote/rsc
// v6) silently drops array/object-literal expression attributes entirely
// (the prop arrives as `undefined`, no compile error, no warning — a real
// trap). Plain string attributes (quoted, no `{}`, or `{"a string"}`) work
// fine; only literal array/object expressions inside `{}` are affected.
// JSON-in-a-string sidesteps it completely and needs no special MDX syntax
// support at all.

/**
 * In-content CTA box — same accent-soft/border-accent visual language
 * already used throughout this app (e.g. app/components/QuotePreviewWidget.tsx's
 * result box, NftCollectionStats.tsx's emphasized stat). `href` is always a
 * real internal route (/swap, /nft/...) — never an external link, since the
 * whole point is steering a reader toward this app's own product.
 */
export function Callout({ href, cta, children }: { href: string; cta: string; children: React.ReactNode }) {
  return (
    <div className="my-2 flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Real hydration bug found live 2026-08-06 (console error: "<p> cannot
          be a descendant of <p>"): `children` here is MDX-parsed markdown
          text, which MDX already wraps in its own <p> — this component's
          own <p> wrapper produced invalid nested-<p> HTML. A <div> has no
          such ancestor-tag restriction and needs no other change (this app's
          .num/text utility classes work identically on either element). */}
      <div className="text-sm text-ink">{children}</div>
      {/* Real bug found live 2026-08-06 (screenshot-verified, not visible in
          curl'd SSR HTML — the text was always there, just invisible): the
          article wrapper's own [&_a]:text-accent rule (app/blog/[slug]/page.tsx,
          meant for plain inline markdown links inside the prose) was
          overriding this link's text-accent-ink, making the button's text
          color match its own bg-accent background exactly — literally
          invisible, same color on same color. `!` forces this component's
          own color to win regardless of which ancestor [&_a] rule matches. */}
      <Link
        href={href}
        className="!text-accent-ink shrink-0 rounded-xl bg-accent px-4 py-2 text-center text-sm font-semibold transition-all hover:brightness-110"
      >
        {cta} →
      </Link>
    </div>
  );
}

export interface StatBarDatum {
  label: string;
  value: number;
  /** Pre-formatted display value, e.g. "$116M" — kept separate from the raw `value` used for bar-width math. */
  display: string;
}

/**
 * Minimal horizontal bar chart — plain flexbox width percentages (no real
 * SVG, no charting library), proportional to the largest value in `data`.
 * This app only ever needs 1-2 simple comparisons per post, not a
 * general-purpose charting surface. Every value passed in must be real and
 * sourced — this component has no opinion on that, it just renders
 * whatever numbers the post provides. `data` is a JSON string — see this
 * file's top comment for why.
 */
export function StatBar({ title, data, unit }: { title: string; data: string; unit?: string }) {
  const parsed: StatBarDatum[] = JSON.parse(data);
  const max = Math.max(...parsed.map((d) => d.value), 1);
  return (
    <div className="my-2 flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {title}
        {unit ? ` (${unit})` : ""}
      </p>
      <div className="flex flex-col gap-2.5">
        {parsed.map((d) => (
          <div key={d.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-ink">{d.label}</span>
              <span className="num text-ink-muted">{d.display}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (d.value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small "N key facts" box for the top of a post — same visual role as a TL;DR. `items` is a JSON string — see this file's top comment for why. */
export function QuickFacts({ items }: { items: string }) {
  const parsed: string[] = JSON.parse(items);
  return (
    <div className="my-2 flex flex-col gap-2 rounded-2xl border border-hairline bg-surface-hover p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Quick facts</p>
      <ul className="flex flex-col gap-1.5 text-sm text-ink-muted">
        {parsed.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-accent" aria-hidden="true">
              •
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
