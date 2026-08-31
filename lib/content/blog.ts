import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// Content-as-files pattern (frontmatter + MDX body) rather than
// @next/mdx's page-per-file compiler or a hand-rolled markdown parser
// (the latter is what /home/darrkito/luvory-genius-generator does — their
// own commit history flags it as a maintenance smell). next-mdx-remote/rsc
// compiles the body at request time in app/blog/[slug]/page.tsx; this
// module only handles frontmatter + listing, kept dependency-light so
// generateStaticParams/the listing page don't need to compile MDX at all.
const BLOG_DIR = path.join(process.cwd(), "content", "blog");
// 2026-08-25 (ES content expansion) — Spanish translations live in a
// sibling directory, same file shape, own slug namespace (real translated
// words, e.g. "que-es-un-swap-cross-chain", not an /es prefix on the
// English slug — see lib/content/blogEsMap.ts's own doc comment for why).
// createBlogReader() below is the same read logic parameterized by
// directory so both languages share one implementation, not two forks
// that can drift.
const BLOG_ES_DIR = path.join(process.cwd(), "content", "blog-es");

export interface HowToStepData {
  name: string;
  text: string;
}

export interface HowToData {
  summary: string;
  totalTime?: string; // ISO 8601 duration, e.g. "PT5M"
  tools?: string[];
  steps: HowToStepData[];
}

export interface FaqData {
  question: string;
  answer: string;
}

export interface BlogPostMeta {
  slug: string;
  title: string;
  // Shorter variant for the <title> tag / OG title when `title` (used as
  // the on-page H1) would push the rendered "<title> | Blockchains.Click"
  // past ~70 characters and risk truncation in search results (Bing SEO
  // audit, 2026-08-31). Falls back to `title` when unset.
  metaTitle?: string;
  description: string;
  date: string; // ISO 8601 (YYYY-MM-DD)
  category: string;
  image?: string;
  readingTimeMinutes: number;
  // 2026-08-07 (blog tutorial-hub upgrade) — all optional, a post that
  // omits every one of these behaves exactly as before this pass. Real
  // YAML frontmatter (via gray-matter), NOT MDX body component props —
  // see BlogComponents.tsx's own top comment for the confirmed
  // next-mdx-remote/rsc bug that silently drops array/object-literal MDX
  // attribute expressions; frontmatter has no such limitation.
  updatedDate?: string; // ISO 8601 (YYYY-MM-DD), only shown/used when it differs from `date`
  chains?: string[]; // SWAP_CHAINS slugs, e.g. ["solana", "ethereum"]
  howTo?: HowToData;
  faq?: FaqData[];
  // 2026-08-08 (SEO/entity-recognition pass) — named entities (brands,
  // projects, tokens) this post is substantively about, e.g.
  // ["Claynosaurz", "Doggy"] — feeds articleSchema's `mentions` (real
  // schema.org property, helps search engines and AI answer engines
  // associate this page with those specific entities) rather than relying
  // on prose alone.
  mentions?: string[];
}

export interface BlogPost extends BlogPostMeta {
  content: string; // raw MDX body, compiled by the caller (next-mdx-remote/rsc)
}

const WORDS_PER_MINUTE = 200;

// Rough estimate off the raw MDX source's word count — deliberately not
// trying to strip JSX/component tags out first (a <Callout>/<StatBar>
// block's own words are still real reading content), just a ballpark
// figure like every blog's "N min read" badge already is.
function estimateReadingTimeMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function readPostFile(dir: string, slug: string): { meta: BlogPostMeta; content: string } {
  const raw = fs.readFileSync(path.join(dir, `${slug}.mdx`), "utf8");
  const { data, content } = matter(raw);
  return {
    meta: {
      slug,
      title: String(data.title),
      metaTitle: data.metaTitle ? String(data.metaTitle) : undefined,
      description: String(data.description),
      date: String(data.date),
      category: String(data.category),
      image: data.image ? String(data.image) : undefined,
      readingTimeMinutes: estimateReadingTimeMinutes(content),
      updatedDate: data.updatedDate ? String(data.updatedDate) : undefined,
      chains: Array.isArray(data.chains) ? data.chains.map(String) : undefined,
      howTo: data.howTo as HowToData | undefined,
      faq: data.faq as FaqData[] | undefined,
      mentions: Array.isArray(data.mentions) ? data.mentions.map(String) : undefined,
    },
    content,
  };
}

function allSlugsIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""));
}

/** All post slugs, derived from filenames — feeds generateStaticParams and the sitemap. */
export function getAllBlogSlugs(): string[] {
  return allSlugsIn(BLOG_DIR);
}

/** Metadata for every post, newest first — powers the /blog listing page. */
export function getAllBlogPosts(): BlogPostMeta[] {
  return getAllBlogSlugs()
    .map((slug) => readPostFile(BLOG_DIR, slug).meta)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Full post (metadata + raw MDX body) for a single slug, or null if it doesn't exist. */
export function getBlogPost(slug: string): BlogPost | null {
  if (!getAllBlogSlugs().includes(slug)) return null;
  const { meta, content } = readPostFile(BLOG_DIR, slug);
  return { ...meta, content };
}

/** Spanish-content equivalents of the three functions above — same shape,
 * own directory/slug namespace (content/blog-es). */
export function getAllBlogSlugsEs(): string[] {
  return allSlugsIn(BLOG_ES_DIR);
}

export function getAllBlogPostsEs(): BlogPostMeta[] {
  return getAllBlogSlugsEs()
    .map((slug) => readPostFile(BLOG_ES_DIR, slug).meta)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getBlogPostEs(slug: string): BlogPost | null {
  if (!getAllBlogSlugsEs().includes(slug)) return null;
  const { meta, content } = readPostFile(BLOG_ES_DIR, slug);
  return { ...meta, content };
}
