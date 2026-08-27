import Link from "next/link";
import { SocialXLink } from "@/app/components/SocialXLink";
import { MORE_TOOLS } from "@/lib/content/moreTools";

// 2026-08-05 (SEO/landing-page overhaul) — this app had zero footer
// anywhere before this. Real internal-linking value (every real route,
// crawlable from every page since this renders in the root layout, not
// just the landing page) — same principle /home/darrkito/
// luvory-genius-generator's own footer nav follows.
//
// 2026-08-11 (site-wide conversion/retention pass) — real gap found and
// fixed: this only ever linked 5 of the app's 22 real routes, missing
// /dashboard specifically — arguably the single highest-retention-value
// page in the whole app (points/referrals/push-notification opt-in) had no
// footer link anywhere. MORE_TOOLS (lib/content/moreTools.ts) is the same
// shared list the homepage's "More tools" section renders, so this can't
// drift into listing a different set than the homepage does.
const LINKS: Array<{ href: string; label: string }> = [
  { href: "/swap", label: "Swap" },
  { href: "/nft", label: "NFT Marketplace" },
  { href: "/dashboard", label: "Rewards" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
];

export function Footer() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl px-6 py-8">
      <div className="flex flex-col gap-4 border-t border-hairline pt-6">
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-ink-muted transition-colors hover:text-accent">
              {link.label}
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
          {MORE_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-accent"
            >
              <span aria-hidden="true">{tool.icon}</span>
              {tool.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row sm:justify-between">
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

          <div className="flex items-center gap-3">
            {/* Added 2026-08-19 (SEO checklist audit) -- real gap, no
                Privacy/Terms links anywhere on the site before this. */}
            <Link href="/security" className="text-xs text-ink-faint transition-colors hover:text-accent">
              Security
            </Link>
            <Link href="/privacy" className="text-xs text-ink-faint transition-colors hover:text-accent">
              Privacy
            </Link>
            <Link href="/terms" className="text-xs text-ink-faint transition-colors hover:text-accent">
              Terms
            </Link>
            <SocialXLink className="text-ink-faint transition-colors hover:text-accent" />
            <p className="text-xs text-ink-faint">© {new Date().getFullYear()} Blockchains.Click</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
