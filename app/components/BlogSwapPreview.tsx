import { QuotePreviewWidget } from "@/app/components/QuotePreviewWidget";
import { resolveSwapChainSlug } from "@/lib/chains/swapChains";

// Contextual, pre-filled live swap widget embedded directly in a tutorial's
// steps (2026-08-07) — reuses QuotePreviewWidget's initialSellChainId/
// initialBuyChainId props (built earlier today for the /swap/[pair] landing
// pages) rather than new plumbing. Plain string MDX attributes — see
// RouteDiagram.tsx's comment on why these don't need the JSON-string
// workaround StatBar/QuickFacts require.
//
// resolveSwapChainSlug (not the plainer swapChainForSlug) so "bitcoin"/
// "sui" resolve too (2026-08-18) — those two are deliberately excluded
// from SWAP_CHAINS itself (see BTC_CHAIN_ID/SUI_CHAIN_ID's own docs), so
// the plain lookup silently returned null here, same gap already found and
// fixed in QuotePreviewWidget.tsx's own swapHref.
export function BlogSwapPreview({ sellChain, buyChain }: { sellChain: string; buyChain: string }) {
  const from = resolveSwapChainSlug(sellChain);
  const to = resolveSwapChainSlug(buyChain);
  if (!from || !to) return null;

  return (
    <div className="my-2 flex justify-center">
      <QuotePreviewWidget initialSellChainId={from.chainId} initialBuyChainId={to.chainId} />
    </div>
  );
}
