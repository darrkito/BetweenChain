import type { Metadata } from "next";
import { Suspense } from "react";
import { SwapPageClient } from "./SwapPageClient";
import { SwapPageFallback } from "./SwapPageFallback";

// 2026-08-05 (landing-page overhaul, Phase 2) — this route used to BE `/`
// (the whole app was the swap tool, no separate landing page existed). The
// swap UI itself (SwapPageClient.tsx, unchanged internally — wallet state,
// quote/swap-execution flow) is a client component and can't export
// generateMetadata directly, so this thin Server Component wrapper exists
// purely to give /swap its own real metadata — same split pattern already
// used for the NFT collection detail page (see app/nft/[vendor]/[slug]/
// page.tsx + CollectionPageClient.tsx).
// Title made keyword-specific (2026-08-11, SEO pass) — was just "Swap" (one
// word, no real target keyword), while GSC showed this page indexed
// correctly but with almost no impressions. Not a technical indexing bug
// (confirmed via the URL Inspection API — "Submitted and indexed", crawled,
// canonical correct); title/description matching real search phrasing is
// the actual lever available here.
export const metadata: Metadata = {
  title: "Swap Tokens Across Chains — Solana & Ethereum",
  description:
    "Swap meme coins and tokens across Solana, Ethereum, and more — one click, no bridging headaches. Connect your wallet and go.",
  alternates: { canonical: "/swap" },
};

export default function SwapPage() {
  // Suspense boundary (2026-08-07) — SwapPageClient now reads useSearchParams()
  // (for the ?sell=&buy= pair-page prefill) which requires one, or Next.js
  // deopts this whole static page into fully dynamic rendering.
  //
  // Real `fallback` added 2026-09-01 (GSC audit) — without one, this was
  // the ONE page-level Suspense boundary that ends up as the nearest
  // ancestor for AppHeader's wallet-only dynamic(ssr:false) children, so
  // their bailout swallowed this entire page's content (H1, subtext, swap
  // widget, even AppHeader) instead of staying isolated to just those small
  // widgets the way it does on every other page. See SwapPageFallback.tsx
  // for the full mechanism writeup. This fallback is real static content
  // (not a spinner) so non-JS crawlers get something meaningful instead of
  // an empty shell; real users see it for a flash before hydration swaps in
  // the live SwapPageClient.
  return (
    <Suspense fallback={<SwapPageFallback />}>
      <SwapPageClient />
    </Suspense>
  );
}
