import type { Metadata } from "next";
import { Suspense } from "react";
import { SwapPageClient } from "./SwapPageClient";

// 2026-08-05 (landing-page overhaul, Phase 2) — this route used to BE `/`
// (the whole app was the swap tool, no separate landing page existed). The
// swap UI itself (SwapPageClient.tsx, unchanged internally — wallet state,
// quote/swap-execution flow) is a client component and can't export
// generateMetadata directly, so this thin Server Component wrapper exists
// purely to give /swap its own real metadata — same split pattern already
// used for the NFT collection detail page (see app/nft/[vendor]/[slug]/
// page.tsx + CollectionPageClient.tsx).
export const metadata: Metadata = {
  title: "Swap",
  description:
    "Swap meme coins and tokens across Solana, Ethereum, and more — one click, no bridging headaches. Connect your wallet and go.",
  alternates: { canonical: "/swap" },
};

export default function SwapPage() {
  // Suspense boundary (2026-08-07) — SwapPageClient now reads useSearchParams()
  // (for the ?sell=&buy= pair-page prefill) which requires one, or Next.js
  // deopts this whole static page into fully dynamic rendering. No fallback
  // UI needed — the client component itself already handles its own loading
  // states for every async piece it has.
  return (
    <Suspense>
      <SwapPageClient />
    </Suspense>
  );
}
