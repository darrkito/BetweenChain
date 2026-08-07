// Sticky table of contents (2026-08-07, blog tutorial-hub upgrade). No
// client JS needed — plain anchor links (`#id`) already scroll to the real
// heading ids lib/content/headingSlug.ts's rehypeHeadingIds sets, so this
// stays a Server Component like Breadcrumb.tsx. Renders as a bordered block
// ABOVE the article on mobile (`order-first`) and a sticky borderless side
// column at `lg:` (the parent layout in app/blog/[slug]/page.tsx switches to
// a row at that breakpoint) — same heading list feeds both.
export function TableOfContents({ headings }: { headings: Array<{ id: string; text: string }> }) {
  if (headings.length < 2) return null; // not worth a TOC for 0-1 sections

  return (
    <nav className="order-first flex flex-col gap-1.5 rounded-2xl border border-hairline bg-surface p-4 lg:sticky lg:top-6 lg:order-2 lg:w-56 lg:shrink-0 lg:self-start lg:border-0 lg:bg-transparent lg:p-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">On this page</p>
      <ul className="flex flex-col gap-1.5 text-sm lg:border-l lg:border-hairline lg:pl-3">
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className="text-ink-muted transition-colors hover:text-accent">
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
