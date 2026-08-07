import { swapChainForSlug } from "@/lib/chains/swapChains";
import { describeExecutionRoute } from "@/lib/chains/executionRoute";

const ENGINE_LABEL: Record<"jupiter" | "relay", string> = { jupiter: "Jupiter", relay: "Relay" };

// Schematic route/execution-pathway diagram, usable directly from blog post
// MDX body content (2026-08-07). Real engines only (Jupiter, Relay) — same
// correction to the "Jupiter -> deBridge -> Uniswap V3" example made
// elsewhere this session; those aren't integrated. `sellChain`/`buyChain`
// are plain string MDX attributes, NOT the JSON-string workaround
// BlogComponents.tsx's StatBar/QuickFacts need — that bug is specific to
// array/object-literal `{...}` expression attributes; a scalar string
// attribute like `sellChain="solana"` is unaffected.
export function RouteDiagram({ sellChain, buyChain }: { sellChain: string; buyChain: string }) {
  const from = swapChainForSlug(sellChain);
  const to = swapChainForSlug(buyChain);
  if (!from || !to) return null;

  // Default (native-token-to-native-token) route — same real fact
  // established for the /swap/[pair] landing pages: a native/native swap
  // is always single-leg, regardless of direction.
  const route = describeExecutionRoute({ isSolanaOrigin: from.slug === "solana", needsJupiterLeg: false, isCrossChain: true });

  return (
    <div className="my-2 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-hairline bg-surface p-5 text-sm">
      <span className="rounded-full border border-hairline bg-surface-hover px-3 py-1.5 font-medium text-ink">{from.label} Wallet</span>
      {route.map((leg) => (
        <span key={leg.engine} className="flex items-center gap-2">
          <span aria-hidden="true" className="text-ink-faint">
            →
          </span>
          <span className="rounded-full border border-hairline px-3 py-1.5 font-medium text-accent">{ENGINE_LABEL[leg.engine]}</span>
        </span>
      ))}
      <span aria-hidden="true" className="text-ink-faint">
        →
      </span>
      <span className="rounded-full border border-hairline bg-surface-hover px-3 py-1.5 font-medium text-ink">{to.label} Wallet</span>
    </div>
  );
}
