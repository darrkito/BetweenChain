import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { swapChainForSlug } from "@/lib/chains/swapChains";

// Contextual, pre-filled live swap widget embedded directly in a tutorial's
// steps (2026-08-07) — reuses QuotePreviewWidget's initialSellChainId/
// initialBuyChainId props (built earlier today for the /swap/[pair] landing
// pages) rather than new plumbing. Plain string MDX attributes — see
// RouteDiagram.tsx's comment on why these don't need the JSON-string
// workaround StatBar/QuickFacts require.
export function BlogSwapPreview({ sellChain, buyChain }: { sellChain: string; buyChain: string }) {
  const from = swapChainForSlug(sellChain);
  const to = swapChainForSlug(buyChain);
  if (!from || !to) return null;

  return (
    <div className="my-2 flex justify-center">
      <QuotePreviewWidget initialSellChainId={from.chainId} initialBuyChainId={to.chainId} />
    </div>
  );
}
