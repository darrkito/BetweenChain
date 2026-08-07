import { swapChainForChainId } from "@/lib/chains/swapChains";

const ENGINE_LABEL: Record<"jupiter" | "relay", string> = { jupiter: "Jupiter", relay: "Relay" };

// Route/execution-pathway visualizer inside the Swap Card, shown before
// execution (2026-08-07) — real engines only (Jupiter, Relay), text-only
// badges (no hosted Jupiter/Relay logo files exist, same decision already
// made for TrustBar.tsx). Fed by preview.route, which is fee-INDEPENDENT
// (see lib/chains/executionRoute.ts) — always reflects the real engine(s)
// executing the swap, not gated by whether this app's own platform fee
// happens to be configured for that leg.
export function RoutePathVisualizer({
  sellChainId,
  buyChainId,
  route,
}: {
  sellChainId: number;
  buyChainId: number;
  route: Array<{ label: string; engine: "jupiter" | "relay" }>;
}) {
  const sellChain = swapChainForChainId(sellChainId);
  const buyChain = swapChainForChainId(buyChainId);
  if (!sellChain || !buyChain) return null;

  // De-duplicate engine badges (a Jupiter+Relay route only ever has one of
  // each, but this stays correct if that ever changes).
  const engines = Array.from(new Set(route.map((leg) => leg.engine)));

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-surface-hover px-3 py-2 text-xs text-ink-muted">
      <span className="font-medium text-ink">{sellChain.label}</span>
      {engines.map((engine) => (
        <span key={engine} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-ink-faint">
            →
          </span>
          <span className="rounded-full border border-hairline bg-surface px-2 py-0.5 font-medium text-accent">
            {ENGINE_LABEL[engine]}
          </span>
        </span>
      ))}
      <span aria-hidden="true" className="text-ink-faint">
        →
      </span>
      <span className="font-medium text-ink">{buyChain.label}</span>
    </div>
  );
}
