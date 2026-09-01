import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { Reveal } from "@/app/components/Reveal";
import { getAllBlogPosts } from "@/lib/content/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Guides and updates on cross-chain swaps, NFTs, and how Blockchains.Click works under the hood.",
  alternates: { canonical: "/blog" },
};

const BREADCRUMB_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Blog" },
];

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function BlogIndexPage() {
  const posts = getAllBlogPosts();

  return (
    // Widened to match the same max-w-5xl AppHeader convention every other
    // page uses (real user report: blog rendered noticeably narrower than
    // the rest of the site) — the card list itself gets its own max-w-3xl
    // wrapper, same width as the post detail page's article column, so a
    // reader moving from listing to detail sees a consistent column width.
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Blog</h1>
          <p className="text-base text-ink-muted">Guides and updates on cross-chain swaps, NFTs, and how this all works.</p>
        </div>

        {/* Real redundancy fixed 2026-08-11 (site-wide audit) — this card
            used to show BOTH the post's opengraph-image (which itself has
            the title/category baked into the graphic, see
            app/blog/[slug]/opengraph-image.tsx) AND the same title/
            category as real text directly below it. Same information
            twice per card, and the tall 1200x630 image made a ~20-post
            list roughly 31,000px tall. The OG image's real job is social-
            media link previews (X/Discord unfurls), not an in-app list
            thumbnail — dropped here, kept everywhere it's actually needed
            (real <meta> tags, unchanged). Text-only cards scan far faster
            for a list this long.
            2026-08-12 (de-generic-ify pass, broader sweep) — floating
            rounded-2xl/shadow/hover-lift cards replaced with a flush
            divided list (`divide-y`) — same editorial-list pattern the
            homepage's FAQ preview already uses, appropriate here too since
            this was already a single-column text list, not a grid. See
            PLAN.md's "de-AI-ify" entry. */}
        <div className="flex flex-col divide-y divide-hairline border-y border-hairline">
          {posts.map((post, i) => {
            const card = (
              <Link
                href={`/blog/${post.slug}`}
                className="group flex flex-col gap-2 px-1 py-5 transition-colors duration-100 hover:bg-surface-hover"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-faint">
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{post.category}</span>
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{post.readingTimeMinutes} min read</span>
                </div>
                <h2 className="font-display text-xl font-normal text-ink">{post.title}</h2>
                <p className="text-sm text-ink-muted">{post.description}</p>
              </Link>
            );
            // First card only, not <Reveal> (2026-09-01, PSI audit) — it's
            // above the fold on mobile, and Lighthouse's LCP breakdown
            // identified this exact card's excerpt <p> as the LCP element
            // with 2707ms of "element render delay", almost entirely the
            // scroll-triggered fade-in. Cards below the fold keep Reveal;
            // there's real UX value in the staggered reveal for a long
            // list, just not for the one card that's already visible.
            return i === 0 ? <div key={post.slug}>{card}</div> : (
              <Reveal key={post.slug} delay={i * 0.05}>
                {card}
              </Reveal>
            );
          })}
        </div>
      </div>
    </main>
  );
}
