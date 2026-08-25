import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
import { Reveal } from "@/app/components/Reveal";
import { getAllBlogPostsEs } from "@/lib/content/blog";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guías y novedades sobre swaps cross-chain, NFTs, y cómo funciona todo esto por dentro.",
  alternates: { canonical: "/es/blog", languages: { "en-US": "/blog", "es-419": "/es/blog" } },
};

// No dedicated /es homepage exists yet (this pass is blog/content only,
// see the ES-expansion scope decision) — "Inicio" links to the real English
// homepage rather than a page that doesn't exist.
const BREADCRUMB_ITEMS = [
  { label: "Inicio", href: "/" },
  { label: "Blog" },
];

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
}

export default function BlogIndexPageEs() {
  const posts = getAllBlogPostsEs();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Breadcrumb items={BREADCRUMB_ITEMS} />

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-normal tracking-tight text-ink sm:text-4xl">Blog</h1>
          <p className="text-base text-ink-muted">Guías y novedades sobre swaps cross-chain, NFTs, y cómo funciona todo esto.</p>
        </div>

        <div className="flex flex-col divide-y divide-hairline border-y border-hairline">
          {posts.map((post, i) => (
            <Reveal key={post.slug} delay={i * 0.05}>
              <Link
                href={`/es/blog/${post.slug}`}
                className="group flex flex-col gap-2 px-1 py-5 transition-colors duration-100 hover:bg-surface-hover"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-faint">
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{post.category}</span>
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span aria-hidden="true">·</span>
                  <span>{post.readingTimeMinutes} min de lectura</span>
                </div>
                <h2 className="font-display text-xl font-normal text-ink">{post.title}</h2>
                <p className="text-sm text-ink-muted">{post.description}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </main>
  );
}
