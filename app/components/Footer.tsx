import Link from "next/link";

// 2026-08-05 (SEO/landing-page overhaul) — this app had zero footer
// anywhere before this. Real internal-linking value (every real route,
// crawlable from every page since this renders in the root layout, not
// just the landing page) — same principle /home/darrkito/
// luvory-genius-generator's own footer nav follows.
const LINKS: Array<{ href: string; label: string }> = [
  { href: "/swap", label: "Swap" },
  { href: "/nft", label: "NFT Marketplace" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
];

export function Footer() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl px-6 py-8">
      <div className="flex flex-col items-center gap-4 border-t border-hairline pt-6 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0">
            <circle cx="6" cy="6" r="2.4" fill="var(--ink-faint)" />
            <circle cx="20" cy="6" r="2.4" fill="var(--ink-faint)" />
            <circle cx="6" cy="20" r="2.4" fill="var(--ink-faint)" />
            <path d="M6 6 13 13M20 6 13 13M6 20 13 13" stroke="var(--ink-faint)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
            <circle cx="13" cy="13" r="4.2" fill="var(--accent)" />
          </svg>
          <span className="text-sm font-medium text-ink-muted">
            Blockchains<span className="text-accent">.Click</span>
          </span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-ink-muted transition-colors hover:text-accent">
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="text-xs text-ink-faint">© {new Date().getFullYear()} Blockchains.Click</p>
      </div>
    </footer>
  );
}
