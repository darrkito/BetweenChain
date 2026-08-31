import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { Reveal } from "@/app/components/Reveal";
import { ShareButton } from "@/app/components/ShareButton";
import { TableOfContents } from "@/app/components/TableOfContents";
import { RouteDiagram } from "@/app/components/RouteDiagram";
import { BlogSwapPreview } from "@/app/components/BlogSwapPreview";
import { BlogTip } from "@/app/components/BlogTip";
import { Callout, StatBar, QuickFacts } from "@/app/components/BlogComponents";
import { BlogTokenStats } from "@/app/components/BlogTokenStats";
import { BlogCollectionCard } from "@/app/components/BlogCollectionCard";
import { FaqSection } from "@/app/components/FaqSection";
import { JsonLd, articleSchema, breadcrumbListSchema, howToSchema, faqPageSchema } from "@/lib/seo/jsonld";
import { getAllBlogSlugs, getBlogPost } from "@/lib/content/blog";
import { extractHeadings, rehypeHeadingIds, slugifyHeading } from "@/lib/content/headingSlug";
import { swapChainForSlug } from "@/lib/chains/swapChains";
import { EN_TO_ES_BLOG_SLUG } from "@/lib/content/blogEsMap";

const SITE_URL = "https://blockchains.click";

const MDX_COMPONENTS = { Callout, StatBar, QuickFacts, RouteDiagram, BlogSwapPreview, BlogTip, BlogTokenStats, BlogCollectionCard };
const MDX_OPTIONS = { mdxOptions: { rehypePlugins: [rehypeHeadingIds] } };

export function generateStaticParams() {
  return getAllBlogSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  const esSlug = EN_TO_ES_BLOG_SLUG[slug];
  const seoTitle = post.metaTitle ?? post.title;
  return {
    title: seoTitle,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`,
      languages: esSlug ? { "en-US": `/blog/${post.slug}`, "es-419": `/es/blog/${esSlug}` } : undefined,
    },
    openGraph: { type: "article", title: seoTitle, description: post.description, publishedTime: post.date },
  };
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    { label: "Blog", href: "/blog" },
    { label: post.title },
  ];
  const postUrl = `${SITE_URL}/blog/${post.slug}`;
  const coverImageUrl = `${postUrl}/opengraph-image`;
  const headings = extractHeadings(post.content);
  // Real chains only — an unrecognized slug in frontmatter is silently
  // dropped rather than rendering a broken badge (same "graceful, not a
  // crash" handling as generateMetadata's own notFound fallback pattern).
  const chainBadges = (post.chains ?? []).map(swapChainForSlug).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const hasRealUpdate = post.updatedDate && post.updatedDate !== post.date;
  const esSlug = EN_TO_ES_BLOG_SLUG[slug];

  return (
    // 2026-08-06 (real user report: blog "looks mobile-only" even on
    // desktop) — this main used to be max-w-2xl, which meant AppHeader
    // (rendered as its first child, same as every other page) rendered at
    // 672px wide here vs. 1024px (max-w-5xl) on the landing/swap/NFT
    // pages — the site's own nav visibly changed width depending which
    // page you were on. Widened to match that same max-w-5xl convention;
    // the article body below gets its own narrower max-w-3xl wrapper for
    // readability instead of constraining the whole page to it.
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto w-full max-w-3xl">
        <Breadcrumb items={breadcrumbItems} />
      </div>

      {/* TOC becomes a sticky side column at lg: (see TableOfContents.tsx's
          own doc) — this flex row is what makes that layout possible;
          single-column, TOC-block-above-article on mobile, unchanged. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 lg:flex-row lg:items-start lg:justify-center">
        <article className="flex w-full max-w-3xl flex-col gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin, Next-generated ImageResponse PNG, not worth next/image's remote-pattern machinery for a route this app already controls */}
          <img src={coverImageUrl} alt="" className="aspect-[1200/630] w-full rounded-2xl border border-hairline object-cover" />

          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-faint">
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{post.category}</span>
              {/* Added 2026-08-19 (SEO checklist audit) -- real gap, no
                  visible author attribution anywhere on a post before this,
                  even though articleSchema below already correctly
                  attributes authorship to the real Organization entity
                  (not a fabricated person -- see that schema's own
                  #organization reference). This just makes the same real
                  attribution visible to a human reader too. */}
              <span>By Blockchains.Click Team</span>
              <span aria-hidden="true">·</span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              {hasRealUpdate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Updated <time dateTime={post.updatedDate}>{formatDate(post.updatedDate!)}</time>
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{post.readingTimeMinutes} min read</span>
              {esSlug && (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={`/es/blog/${esSlug}`} className="text-accent hover:underline">
                    Leer en Español
                  </a>
                </>
              )}
              <span className="ml-auto">
                <ShareButton url={postUrl} />
              </span>
            </div>
            {chainBadges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chainBadges.map((c) => (
                  <span key={c.slug} className="rounded-full border border-hairline bg-surface-hover px-2 py-0.5 text-xs font-medium text-ink-muted">
                    {c.label}
                  </span>
                ))}
              </div>
            )}
            <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">{post.title}</h1>
            <p className="text-base text-ink-muted">{post.description}</p>
          </header>

          <Reveal className="flex max-w-[70ch] flex-col gap-4 text-sm leading-relaxed text-ink-muted [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline [&_h2]:mt-2 [&_h2]:scroll-mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_p]:text-ink-muted [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
            <MDXRemote source={post.content} components={MDX_COMPONENTS} options={MDX_OPTIONS} />
          </Reveal>
        </article>

        <TableOfContents headings={headings} />
      </div>

      {post.faq && <FaqSection items={post.faq} />}

      <JsonLd
        data={articleSchema({
          title: post.title,
          description: post.description,
          slug: post.slug,
          datePublished: post.date,
          dateModified: post.updatedDate,
          image: coverImageUrl,
          mentions: post.mentions,
        })}
      />
      <JsonLd data={breadcrumbListSchema(breadcrumbItems, postUrl)} />
      {post.howTo && (
        <JsonLd
          data={howToSchema({
            slug: post.slug,
            name: post.title,
            summary: post.howTo.summary,
            totalTime: post.howTo.totalTime,
            tools: post.howTo.tools,
            // Each step's id must match the real heading anchor it lives
            // under — see lib/content/headingSlug.ts's doc comment. This
            // app's convention: a howTo step's `name` in frontmatter is the
            // same text as its H2 heading in the article body.
            steps: post.howTo.steps.map((s) => ({ id: slugifyHeading(s.name), name: s.name, text: s.text })),
          })}
        />
      )}
      {post.faq && <JsonLd data={faqPageSchema(post.faq)} />}
    </main>
  );
}
