import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/app/components/AppHeader";
import { Breadcrumb } from "@/app/components/Breadcrumb";
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <AppHeader />
      <Breadcrumb items={BREADCRUMB_ITEMS} />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Blog</h1>
        <p className="text-base text-ink-muted">Guides and updates on cross-chain swaps, NFTs, and how this all works.</p>
      </div>

      <div className="flex flex-col gap-4">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-ink-faint">
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{post.category}</span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
            </div>
            <h2 className="text-lg font-semibold text-ink">{post.title}</h2>
            <p className="text-sm text-ink-muted">{post.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
