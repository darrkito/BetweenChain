import Link from "next/link";
import { MORE_TOOLS } from "@/lib/content/moreTools";

// Real fallback for the <Suspense> in page.tsx (2026-09-01, GSC audit).
// SwapPageClient's tree includes AppHeader, which has 3 dynamic(ssr:false)
// wallet-dependent children (ConnectWalletMenu, PortfolioDrawer, PointsPill)
// — on every OTHER page those self-isolate to their own small slot, but
// /swap is the one page with an extra explicit page-level <Suspense>
// (needed for useSearchParams(), see the comment in page.tsx), and with no
// fallback given, that boundary was the nearest ancestor catching the
// bailout — swallowing the ENTIRE tree (H1, subtext, swap widget, even
// AppHeader) instead of just the wallet-only bits. Confirmed via the raw
// prerendered HTML: zero <h1>, 401 words, a single
// `BAILOUT_TO_CLIENT_SIDE_RENDERING` marker exactly where all of that
// should be — meaning any crawler that doesn't execute JS (Bing, most
// AI/LLM crawlers, link-preview bots) saw a page with no real content at
// all on this specific route.
//
// This fallback is deliberately plain server-rendered JSX — no client-only
// imports, no animation wrapper — so it's guaranteed to actually reach the
// initial HTML. It's swapped out for the real interactive SwapPageClient
// the instant JS hydrates, so real users never see it for more than a
// flash; it exists purely so non-JS crawlers get real content instead of
// nothing.
export function SwapPageFallback() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <div className="grid w-full gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
          <h1 className="font-display px-1 text-2xl font-normal text-ink">Swap</h1>
          <p className="px-1 text-sm text-ink-muted">
            Cross-chain and same-chain swaps across Solana, Ethereum, and more — no bridging, no manual steps.
          </p>
          <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-5">
            <p className="text-sm text-ink-muted">
              Connect a wallet to get a live quote and swap meme coins and tokens across 8+ chains in one click.
            </p>
          </div>
          <p className="px-1 text-xs text-ink-faint">
            🔒 Destination address locked at quote time, re-verified on-chain before every swap completes.{" "}
            <Link href="/blog/swap-security-101" className="font-medium text-accent hover:underline">
              How it works →
            </Link>
          </p>
          <Link
            href="/blog/how-cross-chain-swaps-work"
            className="flex items-center gap-1.5 self-start text-sm font-medium text-ink-muted transition-colors hover:text-accent"
          >
            How does a cross-chain swap actually work?
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
        <h2 className="px-1 text-sm font-semibold text-ink-muted">More tools</h2>
        <div className="grid grid-cols-3 gap-px border border-hairline bg-hairline sm:grid-cols-5">
          {MORE_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex flex-col items-center gap-2 bg-surface px-2 py-4 text-center transition-colors duration-100 hover:bg-surface-hover"
            >
              <span aria-hidden="true" className="text-xl">
                {tool.icon}
              </span>
              <span className="text-[11px] font-medium text-ink-muted">{tool.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
