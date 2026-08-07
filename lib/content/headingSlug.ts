// Dependency-free heading-anchor slugify + a tiny custom rehype plugin
// (2026-08-07, blog tutorial-hub upgrade) — deliberately NOT the
// `rehype-slug` package: this codebase's own established preference for a
// small dependency-free module over a library for something this size (see
// lib/seo/jsonld.tsx's own "one small, dependency-free module rather than a
// library" comment). Both `rehypeHeadingIds` (sets the real rendered anchor
// id) and `extractHeadings` (builds the sticky TOC's link list) call this
// SAME function, so a TOC link and its target anchor can never drift apart.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function textContent(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textContent).join("");
}

/**
 * Rehype plugin — walks the compiled tree, sets a real `id` on every `h2`
 * (the only heading level this app's blog posts use — see
 * app/blog/[slug]/page.tsx's `[&_h2]` prose styling) so the sticky TOC's
 * links, HowTo JSON-LD step URLs, and normal browser deep-links (#anchor)
 * all resolve to a real element.
 */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    function visit(node: HastNode) {
      if (node.tagName === "h2") {
        const id = slugifyHeading(textContent(node));
        node.properties = { ...node.properties, id };
      }
      (node.children ?? []).forEach(visit);
    }
    visit(tree);
  };
}

/**
 * Extracts `{id, text}` for every H2 in raw MDX source, for the sticky
 * TOC — a simple line regex over the raw markdown (same "good enough over
 * raw source" approach lib/content/blog.ts's own reading-time estimator
 * already uses), not a full AST parse. Must produce the exact same `id` as
 * `rehypeHeadingIds` for the same heading text — both call `slugifyHeading`.
 */
export function extractHeadings(mdxSource: string): Array<{ id: string; text: string }> {
  const headings: Array<{ id: string; text: string }> = [];
  for (const line of mdxSource.split("\n")) {
    const match = /^##\s+(.+)$/.exec(line.trim());
    if (match) {
      const text = match[1].trim();
      headings.push({ id: slugifyHeading(text), text });
    }
  }
  return headings;
}
