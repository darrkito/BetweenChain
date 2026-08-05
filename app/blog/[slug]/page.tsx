import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { JsonLd, articleSchema, breadcrumbListSchema } from "@/lib/seo/jsonld";
import { getAllBlogSlugs, getBlogPost } from "@/lib/content/blog";

const SITE_URL = "https://blockchains.click";

export function generateStaticParams() {
  return getAllBlogSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.description, publishedTime: post.date },
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <AppHeader />
      <Breadcrumb items={breadcrumbItems} />

      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-faint">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{post.category}</span>
            <time dateTime={post.date}>{formatDate(post.date)}</time>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">{post.title}</h1>
          <p className="text-base text-ink-muted">{post.description}</p>
        </header>

        <div className="flex flex-col gap-4 text-sm leading-relaxed text-ink-muted [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_p]:text-ink-muted [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
          <MDXRemote source={post.content} />
        </div>
      </article>

      <JsonLd
        data={articleSchema({ title: post.title, description: post.description, slug: post.slug, datePublished: post.date })}
      />
      <JsonLd data={breadcrumbListSchema(breadcrumbItems, `${SITE_URL}/blog/${post.slug}`)} />
    </main>
  );
}
